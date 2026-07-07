import { ChevronRight, FolderOpen, Home, MoveRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/components/Button.jsx";
import { IconButton } from "../../../shared/components/IconButton.jsx";
import { filesApi } from "../filesApi.js";
import { FolderGlyph } from "./FolderGlyph.jsx";

export function MoveDialog({ files = [], ownerId = "", onMove, onClose }) {
  const moveFiles = useMemo(() => files.filter(Boolean), [files]);
  const movingKey = useMemo(() => moveFiles.map((file) => file.id).sort().join("|"), [moveFiles]);
  const movingIds = useMemo(() => new Set(moveFiles.map((file) => file.id)), [moveFiles]);
  const [stack, setStack] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const parentId = stack.at(-1)?.id || null;

  useEffect(() => {
    setStack([]);
  }, [movingKey]);

  useEffect(() => {
    if (!moveFiles.length) return undefined;
    let active = true;

    async function loadFolders() {
      setLoading(true);
      setError("");
      try {
        const result = await filesApi.list({ parentId, ownerId });
        if (!active) return;
        setFolders(result.files.filter((file) => file.type === "folder" && !movingIds.has(file.id)));
      } catch (nextError) {
        if (active) setError(nextError.message || "폴더를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadFolders();
    return () => {
      active = false;
    };
  }, [moveFiles.length, movingIds, ownerId, parentId]);

  if (!moveFiles.length) return null;

  const title = moveFiles.length === 1 ? moveFiles[0].name : `${moveFiles.length}개 항목`;

  function openFolder(folder) {
    setStack((items) => [...items, { id: folder.id, name: folder.name }]);
  }

  function navigateTo(index) {
    setStack((items) => index < 0 ? [] : items.slice(0, index + 1));
  }

  async function confirmMove(targetParentId) {
    if (moving) return;
    setMoving(true);
    setError("");
    try {
      const ok = await onMove?.(targetParentId);
      if (ok === false) setError("항목을 이동하지 못했습니다.");
    } catch (nextError) {
      setError(nextError.message || "항목을 이동하지 못했습니다.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="move-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
        <header className="share-dialog-header">
          <div className="panel-title">
            <MoveRight size={18} />
            <span id="move-dialog-title">항목 이동</span>
          </div>
          <IconButton icon={X} label="닫기" onClick={onClose} disabled={moving} />
        </header>

        <div className="move-dialog-body">
          <div className="move-target-summary">
            <strong>{title}</strong>
            <span>{parentId ? stack.at(-1)?.name : "홈"}</span>
          </div>

          <nav className="move-path" aria-label="이동 경로">
            <button type="button" className={!stack.length ? "active" : ""} onClick={() => navigateTo(-1)} disabled={moving}>
              <Home size={15} />
              <span>홈</span>
            </button>
            {stack.map((folder, index) => (
              <span className="move-path-segment" key={folder.id}>
                <ChevronRight size={14} />
                <button type="button" className={index === stack.length - 1 ? "active" : ""} onClick={() => navigateTo(index)} disabled={moving}>
                  <span>{folder.name}</span>
                </button>
              </span>
            ))}
          </nav>

          <div className="move-folder-list" role="list">
            {loading ? <div className="move-folder-state">불러오는 중</div> : null}
            {!loading && folders.length ? folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="move-folder-row"
                onClick={() => openFolder(folder)}
                disabled={moving}
              >
                <FolderGlyph color={folder.folderColor} size={25} />
                <span>{folder.name}</span>
                <ChevronRight size={16} />
              </button>
            )) : null}
            {!loading && !folders.length ? <div className="move-folder-state">폴더 없음</div> : null}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <footer className="move-dialog-footer">
          <Button icon={Home} onClick={() => confirmMove(null)} disabled={moving}>홈으로 이동</Button>
          <Button icon={FolderOpen} variant="primary" onClick={() => confirmMove(parentId)} disabled={moving}>{moving ? "이동 중" : "현재 위치로 이동"}</Button>
        </footer>
      </section>
    </div>
  );
}
