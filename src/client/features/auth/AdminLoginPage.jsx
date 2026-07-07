import { HardDrive, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { useAuth } from "./AuthProvider.jsx";

export function AdminLoginPage() {
  const { user, login, logout } = useAuth();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") {
      window.location.replace("/");
    }
  }, [user?.role]);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const nextUser = await login(id, password);
      if (nextUser.role !== "admin") {
        await logout();
        setError("관리자 권한 계정만 사용할 수 있습니다.");
      }
    } catch (nextError) {
      setError(nextError.message || "관리자 로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (user && user.role !== "admin") {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="auth-title">
            <HardDrive size={32} color="var(--dd-primary)" />
            <div>
              <h1>관리자 로그인</h1>
            </div>
          </div>
          <div className="form-stack">
            <div className="error-banner">관리자 권한 계정으로 다시 로그인해야 합니다.</div>
            <Button onClick={logout}>현재 계정 로그아웃</Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={handleSubmit} autoComplete="off">
        <div className="auth-title">
          <HardDrive size={32} color="var(--dd-primary)" />
          <div>
            <h1>관리자 로그인</h1>
          </div>
        </div>

        <div className="form-stack">
          <label className="field">
            <span>아이디</span>
            <input value={id} onChange={(event) => setId(event.target.value)} autoComplete="off" name="ddato-admin-login-id" />
          </label>
          <label className="field">
            <span>비밀번호</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <Button icon={LogIn} variant="primary" type="submit" disabled={busy}>{busy ? "확인 중" : "관리자 로그인"}</Button>
        </div>
      </form>
    </main>
  );
}
