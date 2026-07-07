import { Save, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { IconButton } from "../../shared/components/IconButton.jsx";
import { useAuth } from "./AuthProvider.jsx";

export function ProfileDialog({ onClose }) {
  const { user, updateProfile } = useAuth();
  const isGoogleUser = user?.authProvider === "google";
  const [displayName, setDisplayName] = useState(user?.displayName || user?.id || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || user?.id || "");
  }, [user?.id, user?.displayName]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile(isGoogleUser ? { displayName } : {
        displayName,
        password: password || undefined
      });
      setPassword("");
      setSaved(true);
    } catch (nextError) {
      setError(nextError.message || "프로필을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={save}>
        <header className="share-dialog-header">
          <div className="panel-title">
            <UserRound size={18} />
            <span id="profile-title">계정 설정</span>
          </div>
          <IconButton icon={X} label="닫기" onClick={onClose} />
        </header>

        <div className="share-dialog-body profile-dialog-body">
          <label className="field">
            <span>아이디</span>
            <input value={user?.id || ""} disabled />
          </label>
          <label className="field">
            <span>이름</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
          </label>
          {!isGoogleUser ? (
            <label className="field">
              <span>새 비밀번호</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
          ) : null}
          {saved ? <div className="success-banner">저장되었습니다.</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <footer className="share-dialog-footer">
          <Button onClick={onClose}>닫기</Button>
          <Button icon={Save} variant="primary" type="submit" disabled={busy}>{busy ? "저장 중" : "저장"}</Button>
        </footer>
      </form>
    </div>
  );
}
