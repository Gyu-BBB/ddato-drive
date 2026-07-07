import { Download, File, FileSearch, HardDrive, LockKeyhole, Maximize2, UnlockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { IconButton } from "../../shared/components/IconButton.jsx";
import { PasswordDialog } from "../../shared/components/PasswordDialog.jsx";
import { formatDate } from "../../shared/lib/dates.js";
import { formatBytes } from "../../shared/lib/formatBytes.js";
import { FilePreviewContent, useFilePreview } from "./components/FilePreview.jsx";
import { FolderGlyph } from "./components/FolderGlyph.jsx";
import { FullPreviewDialog } from "./components/FullPreviewDialog.jsx";
import { shareApi } from "./shareApi.js";

export function PublicSharePage({ token }) {
  const [info, setInfo] = useState(null);
  const [parentId, setParentId] = useState("");
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const preview = useFilePreview(
    info?.previewSupported ? info.file : null,
    () => shareApi.publicPreviewBlob(token),
    () => shareApi.publicPreviewUrl(token),
    () => shareApi.publicPreviewStatus(token)
  );

  useEffect(() => {
    setParentId("");
  }, [token]);

  useEffect(() => {
    let active = true;
    setInfo(null);
    setFullPreviewOpen(false);
    setError("");

    shareApi.publicInfo(token, parentId)
      .then((result) => {
        if (!active) return;
        setInfo(result);
      })
      .catch((nextError) => {
        if (active) setError(nextError.message || "공유 링크를 열 수 없습니다.");
      });

    return () => {
      active = false;
    };
  }, [token, parentId]);

  function download() {
    if (info?.passwordRequired) {
      setPasswordDialogOpen(true);
      return;
    }
    window.location.href = shareApi.publicDownloadUrl(token);
  }

  async function unlockShare(password) {
    setPasswordDialogOpen(false);
    setUnlockError("");
    try {
      await shareApi.publicUnlock(token, password);
      const result = await shareApi.publicInfo(token, parentId);
      setInfo(result);
    } catch (nextError) {
      setUnlockError(nextError.message || "암호를 확인하지 못했습니다.");
    }
  }

  if (error) {
    return (
      <main className="public-share-page">
        <section className="public-share-panel">
          <HardDrive size={34} color="var(--dd-primary)" />
          <h1>공유 링크를 사용할 수 없습니다</h1>
          <div className="error-banner">{error}</div>
        </section>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="public-share-page">
        <section className="public-share-panel">
          <HardDrive size={34} color="var(--dd-primary)" />
          <h1>DDATO Drive</h1>
          <p className="muted">불러오는 중</p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-share-page">
      <section className="public-share-panel">
        <header className="public-share-header">
          <div className="brand-mark">
            <HardDrive size={24} />
            <div>
              <strong>DDATO Drive</strong>
              <span>{info.share.mode === "permanent" ? "무제한 공유" : `만료 ${formatDate(info.share.expiresAt)}`}</span>
            </div>
          </div>
          <Button icon={info.passwordRequired ? UnlockKeyhole : Download} variant="primary" onClick={download}>{info.passwordRequired ? "암호 입력" : "다운로드"}</Button>
        </header>

        <div className="public-share-preview">
          {info.passwordRequired ? (
            <div className="public-share-locked">
              <LockKeyhole size={42} />
              <strong>암호가 필요한 공유 링크입니다</strong>
              <span>미리보기와 다운로드를 사용하려면 암호를 입력하세요.</span>
              {unlockError ? <div className="error-banner">{unlockError}</div> : null}
              <Button icon={UnlockKeyhole} variant="primary" onClick={() => setPasswordDialogOpen(true)}>암호 입력</Button>
            </div>
          ) : info.file.type === "folder" ? (
            <SharedFolderBrowser folder={info.folder} token={token} onNavigate={setParentId} />
          ) : (
            <>
              <IconButton
                className="preview-fullscreen-button"
                icon={Maximize2}
                label="전체 보기"
                onClick={() => setFullPreviewOpen(true)}
                disabled={!info.previewSupported}
              />
              <SharedPreview file={info.file} preview={preview} previewSupported={info.previewSupported} />
            </>
          )}
        </div>

        <footer className="public-share-meta">
          {info.file.type === "folder" ? <FolderGlyph color={info.file.folderColor} size={18} /> : <FileSearch size={18} />}
          <div>
            <strong>{info.file.name}</strong>
            <span>{shareMeta(info)}</span>
          </div>
        </footer>
      </section>
      {fullPreviewOpen ? <FullPreviewDialog file={info.file} preview={preview} onClose={() => setFullPreviewOpen(false)} onDownload={download} /> : null}
      {passwordDialogOpen ? (
        <PasswordDialog
          title="공유 링크 암호"
          body="공유된 항목을 열려면 암호를 입력하세요."
          confirmLabel="잠금 해제"
          onSubmit={unlockShare}
          onClose={() => setPasswordDialogOpen(false)}
        />
      ) : null}
    </main>
  );
}

function SharedFolderBrowser({ folder, token, onNavigate }) {
  const files = folder?.files || [];
  const path = folder?.path || [];

  return (
    <div className="public-folder-browser">
      <nav className="public-folder-path" aria-label="공유 폴더 위치">
        {path.map((item, index) => (
          <button key={item.id} type="button" onClick={() => onNavigate(index === 0 ? "" : item.id)}>
            {item.name}
          </button>
        ))}
      </nav>

      {files.length ? (
        <div className="public-folder-list" role="list">
          {files.map((item) => (
            <div key={item.id} className="public-folder-row" role="listitem">
              <button
                type="button"
                className="public-folder-open"
                onClick={() => item.type === "folder" ? onNavigate(item.id) : window.location.assign(shareApi.publicItemDownloadUrl(token, item.id))}
              >
                {item.type === "folder" ? <FolderGlyph color={item.folderColor} size={20} /> : <File size={20} />}
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.type === "folder" ? "폴더" : formatBytes(item.sizeBytes)}</small>
                </span>
              </button>
              <a className="public-folder-download" href={shareApi.publicItemDownloadUrl(token, item.id)} aria-label={`${item.name} 다운로드`}>
                <Download size={17} />
              </a>
            </div>
          ))}
        </div>
      ) : (
        <span className="muted">비어 있는 폴더입니다.</span>
      )}
    </div>
  );
}

function SharedPreview({ file, preview, previewSupported }) {
  if (!previewSupported) return <span className="muted">미리보기를 지원하지 않는 파일입니다.</span>;
  return <FilePreviewContent file={file} preview={preview} />;
}

function shareMeta(info) {
  if (info.file.type === "folder") {
    const count = info.folder?.files?.length || 0;
    return `폴더 · ${count}개 항목`;
  }
  return `${info.file.mimeType || "파일"} · ${formatBytes(info.file.sizeBytes)}`;
}
