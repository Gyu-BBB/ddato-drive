import { LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button.jsx";
import { IconButton } from "./IconButton.jsx";

export function PasswordDialog({ title = "암호 입력", body = "", confirmLabel = "확인", recoverLabel = "", onSubmit, onRecover, onClose }) {
  const [password, setPassword] = useState("");

  function submit(event) {
    event.preventDefault();
    if (!password) return;
    onSubmit?.(password);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onSubmit={submit}>
        <header className="share-dialog-header">
          <div className="panel-title">
            <LockKeyhole size={18} />
            <span id="password-dialog-title">{title}</span>
          </div>
          <IconButton icon={X} label="닫기" onClick={onClose} />
        </header>
        <div className="password-dialog-body">
          {body ? <p>{body}</p> : null}
          <label className="field">
            <span>암호</span>
            <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </div>
        <footer className="share-dialog-footer">
          {recoverLabel ? <Button className="password-recovery-button" onClick={onRecover}>{recoverLabel}</Button> : null}
          <span className="dialog-footer-spacer" />
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit" disabled={!password}>{confirmLabel}</Button>
        </footer>
      </form>
    </div>
  );
}
