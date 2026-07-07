import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { GoogleLoginButton } from "./GoogleLoginButton.jsx";

export function LoginPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("authError")) return;
    setError("Google 로그인을 완료하지 못했습니다.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-title">
          <HardDrive size={32} color="var(--dd-primary)" />
          <div>
            <h1>DDATO Drive</h1>
          </div>
        </div>

        <div className="form-stack">
          <GoogleLoginButton />
          {error ? <div className="error-banner">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}
