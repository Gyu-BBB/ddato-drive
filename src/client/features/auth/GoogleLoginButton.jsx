import { useEffect, useState } from "react";
import { authApi } from "./authApi.js";

export function GoogleLoginButton() {
  const [enabled, setEnabled] = useState(null);

  useEffect(() => {
    let disposed = false;
    authApi.googleStatus()
      .then((result) => {
        if (!disposed) setEnabled(Boolean(result.enabled));
      })
      .catch(() => {
        if (!disposed) setEnabled(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  if (enabled === null) {
    return <div className="muted auth-status">Google 로그인 확인 중</div>;
  }

  if (!enabled) {
    return <div className="error-banner">Google 로그인이 설정되지 않았습니다.</div>;
  }

  return (
    <a className="google-login-button" href="/api/auth/google">
      <span className="google-login-mark" aria-hidden="true">G</span>
      <span>Google로 계속하기</span>
    </a>
  );
}
