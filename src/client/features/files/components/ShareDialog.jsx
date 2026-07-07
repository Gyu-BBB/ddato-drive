import { Check, Copy, Link2, LockKeyhole, TimerReset, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/components/Button.jsx";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { formatDate } from "../../../shared/lib/dates.js";
import { shareApi } from "../shareApi.js";

export function ShareDialog({ files = [], onClose }) {
  const shareFiles = useMemo(() => files.filter(Boolean), [files]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharePassword, setSharePassword] = useState("");

  useEffect(() => {
    if (!shareFiles.length) return undefined;
    let active = true;
    setBusy(true);
    setError("");
    setCopied(false);

    Promise.all(shareFiles.map((file) => shareApi.getActive(file.id)
      .then((result) => ({ file, share: result.share || null, error: "" }))
      .catch((nextError) => ({ file, share: null, error: nextError.message || "공유 정보를 불러오지 못했습니다." }))))
      .then((nextItems) => {
        if (!active) return;
        setItems(nextItems);
        const passwords = [...new Set(nextItems.map((item) => item.share?.password || "").filter(Boolean))];
        setSharePassword(passwords.length === 1 ? passwords[0] : "");
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [shareFiles]);

  if (!shareFiles.length) return null;

  async function create(mode) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const password = sharePassword.trim();
      const nextItems = await Promise.all(shareFiles.map((file) => shareApi.create(file.id, mode, password)
        .then((result) => ({ file, share: result.share, error: "" }))
        .catch((nextError) => ({ file, share: null, error: nextError.message || "공유 링크를 만들지 못했습니다." }))));
      setItems(nextItems);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const nextItems = await Promise.all(shareFiles.map((file) => shareApi.revoke(file.id)
        .then(() => ({ file, share: null, error: "" }))
        .catch((nextError) => ({ file, share: null, error: nextError.message || "공유를 해제하지 못했습니다." }))));
      setItems(nextItems);
    } finally {
      setBusy(false);
    }
  }

  async function copyAll() {
    const links = items.filter((item) => item.share?.url).map((item) => {
      const password = item.share.password ? `\n암호: ${item.share.password}` : "";
      return `${item.file.name}: ${item.share.url}${password}`;
    });
    if (!links.length) return;
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      setCopied(true);
    } catch {
      setError("링크를 복사하지 못했습니다.");
    }
  }

  const hasShare = items.some((item) => item.share?.url);
  const title = shareFiles.length === 1 ? shareFiles[0].name : `${shareFiles.length}개 항목`;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <header className="share-dialog-header">
          <div className="panel-title">
            <Link2 size={18} />
            <span id="share-dialog-title">공유 링크</span>
          </div>
          <IconButton icon={X} label="닫기" onClick={onClose} />
        </header>

        <div className="share-dialog-body">
          <div className="share-target">
            <strong>{title}</strong>
            <span>{hasShare ? "공유 중" : "공유 안 함"}</span>
          </div>

          <div className="share-actions">
            <Button icon={TimerReset} onClick={() => create("hour")} disabled={busy}>1시간 링크</Button>
            <Button icon={Link2} onClick={() => create("permanent")} disabled={busy}>무제한 링크</Button>
          </div>

          <label className="share-password-field">
            <span>
              <LockKeyhole size={15} />
              공유 암호
            </span>
            <input
              value={sharePassword}
              onChange={(event) => setSharePassword(event.target.value)}
              placeholder="암호 없이 공유하려면 비워두기"
              autoComplete="off"
            />
          </label>

          {hasShare ? (
            <div className="share-link-list">
              {items.map((item) => item.share ? (
                <label key={item.file.id} className="share-link-item">
                  <span>
                    <strong>{item.file.name}</strong>
                    <small>{shareStatus(item.share)}</small>
                  </span>
                  <input value={item.share.url} readOnly aria-label={`${item.file.name} 공유 링크`} />
                  {item.share.passwordEnabled ? (
                    <span className="share-password-display">
                      <small>공유 암호</small>
                      <input value={item.share.password || ""} readOnly aria-label={`${item.file.name} 공유 암호`} />
                    </span>
                  ) : null}
                </label>
              ) : null)}
            </div>
          ) : null}

          {items.some((item) => item.error) ? (
            <div className="error-banner">{items.find((item) => item.error)?.error}</div>
          ) : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <footer className="share-dialog-footer">
          <Button icon={copied ? Check : Copy} variant="primary" onClick={copyAll} disabled={busy || !hasShare}>{copied ? "복사됨" : "전체 복사"}</Button>
          <Button variant="danger" onClick={revoke} disabled={busy || !hasShare}>공유 해제</Button>
        </footer>
      </section>
    </div>
  );
}

function shareStatus(share) {
  const base = share.mode === "permanent" ? "무제한" : `만료 ${formatDate(share.expiresAt)}`;
  return share.passwordEnabled ? `${base} · 암호 있음` : base;
}
