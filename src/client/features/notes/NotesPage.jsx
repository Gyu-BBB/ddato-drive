import { FileText, Loader2, LockKeyhole, MoreHorizontal, Plus, RefreshCcw, Search, Trash2, UnlockKeyhole } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { PasswordDialog } from "../../shared/components/PasswordDialog.jsx";
import { formatDate } from "../../shared/lib/dates.js";
import { notesApi } from "./notesApi.js";
import { noteContextMenu } from './noteContextMenu.js';
import { DriveContextMenu } from '../files/components/DriveContextMenu.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { adminApi } from '../admin/adminApi.js';

export function NotesPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [draftNoteId, setDraftNoteId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const [passwordDialog, setPasswordDialog] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const currentRef = useRef(null);
  const saveRequestRef = useRef(0);

  const filteredNotes = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return notes;
    return notes.filter((note) => {
      return `${note.title}\n${note.content}`.toLowerCase().includes(search);
    });
  }, [notes, query]);
  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedId) || null, [notes, selectedId]);
  const isDirty = Boolean(selectedNote && draftNoteId === selectedNote.id && (draftTitle !== selectedNote.title || draftContent !== selectedNote.content));
  currentRef.current = { selectedId, draftNoteId, draftTitle, draftContent, notes };

  useEffect(() => {
    loadNotes();
  }, []);

  useEffect(() => {
    if (notes.length && !notes.some((note) => note.id === selectedId)) {
      setSelectedId(notes[0].id);
    }
    if (!notes.length) {
      setSelectedId("");
    }
  }, [notes, selectedId]);

  useEffect(() => {
    if (!selectedNote) {
      setDraftNoteId("");
      setDraftTitle("");
      setDraftContent("");
      return;
    }

    if (draftNoteId !== selectedNote.id) {
      setDraftNoteId(selectedNote.id);
      setDraftTitle(selectedNote.title);
      setDraftContent(selectedNote.content);
      setSavedAt(0);
    }
  }, [selectedNote, draftNoteId]);

  useEffect(() => {
    if (!isDirty || !selectedNote) return undefined;
    const timer = window.setTimeout(() => {
      saveNote(selectedNote.id, draftTitle, draftContent);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [isDirty, selectedNote?.id, draftTitle, draftContent]);

  async function loadNotes() {
    setBusy(true);
    setError("");
    try {
      const result = await notesApi.list();
      setNotes(result.notes || []);
    } catch (nextError) {
      setError(nextError.message || "메모를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createNote() {
    setError("");
    try {
      const result = await notesApi.create({ title: "새 메모", content: "" });
      setNotes((items) => [result.note, ...items]);
      setSelectedId(result.note.id);
    } catch (nextError) {
      setError(nextError.message || "메모를 만들지 못했습니다.");
    }
  }

  async function saveNote(noteId = selectedId, title = draftTitle, content = draftContent) {
    if (!noteId) return;
    const target = currentRef.current.notes.find(note => note.id === noteId);
    if (target?.passwordProtected && !target.passwordUnlocked) {
      setError("암호를 입력한 뒤 저장할 수 있습니다.");
      return;
    }
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaving(true);
    setError("");
    try {
      const result = await notesApi.update(noteId, { title, content });
      setNotes((items) => sortNotes(items.map((note) => note.id === noteId ? result.note : note)));
      if (saveRequestRef.current === requestId) setSavedAt(Date.now());
    } catch (nextError) {
      setError(nextError.message || "메모를 저장하지 못했습니다.");
    } finally {
      if (saveRequestRef.current === requestId) setSaving(false);
    }
  }

  async function deleteSelectedNote(note = selectedNote) {
    if (!note) return;
    if (!window.confirm(`${note.title} 메모를 삭제할까요?`)) return;
    setError("");
    try {
      await notesApi.remove(note.id);
      setNotes((items) => items.filter((item) => item.id !== note.id));
    } catch (nextError) {
      setError(nextError.message || "메모를 삭제하지 못했습니다.");
    }
  }

  async function setNotePassword(note = selectedNote) {
    if (!note) return;
    if (note.passwordProtected && !note.passwordUnlocked && !(await unlockNote(note, "암호 변경"))) return;
    const password = await requestPassword({
      title: note.passwordProtected ? "메모 암호 변경" : "메모 암호 설정",
      body: `${note.title} 메모에 사용할 암호를 입력하세요.`,
      confirmLabel: note.passwordProtected ? "암호 변경" : "암호 설정"
    });
    if (!password) return;
    try {
      const result = await notesApi.setPassword(note.id, password);
      applyNote(result.note);
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 설정하지 못했습니다.");
    }
  }

  async function clearNotePassword(note = selectedNote) {
    if (!note?.passwordProtected) return;
    const password = await requestPassword({
      title: "메모 암호 해제",
      body: `${note.title} 메모의 암호를 해제하려면 현재 암호를 입력하세요.`,
      confirmLabel: "암호 해제"
    });
    if (!password) return;
    try {
      const result = await notesApi.clearPassword(note.id, password);
      applyNote(result.note);
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 해제하지 못했습니다.");
    }
  }

  async function unlockNote(note = selectedNote, actionLabel = "열람") {
    if (!note) return null;
    if (!note.passwordProtected || note.passwordUnlocked) return note;
    const password = await requestPassword({
      title: "메모 암호 입력",
      body: `${note.title} 메모를 ${actionLabel}하려면 암호가 필요합니다.`,
      confirmLabel: "잠금 해제"
    });
    if (!password) return false;
    try {
      const result = await notesApi.unlock(note.id, password);
      applyNote(result.note);
      return result.note;
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 확인하지 못했습니다.");
      return false;
    }
  }

  function applyNote(note) {
    setNotes((items) => sortNotes(items.map((item) => item.id === note.id ? note : item)));
    if (currentRef.current.selectedId === note.id) {
      currentRef.current = { ...currentRef.current, draftNoteId: note.id, draftTitle: note.title, draftContent: note.content,
        notes: currentRef.current.notes.map(item => item.id === note.id ? note : item) };
      setDraftNoteId(note.id);
      setDraftTitle(note.title);
      setDraftContent(note.content);
    }
  }

  function requestPassword(options) {
    return new Promise((resolve) => setPasswordDialog({ ...options, resolve }));
  }

  function draftFor(note) {
    const current = currentRef.current;
    return current.draftNoteId === note.id ? { title: current.draftTitle, content: current.draftContent } : { title: note.title, content: note.content };
  }

  async function renameNote(note) {
    const target = await unlockNote(note, '이름 변경');
    if (!target) return;
    const title = window.prompt('새 메모 이름', target.title);
    if (!title || title === target.title) return;
    try {
      const result = await notesApi.update(target.id, { ...draftFor(target), title });
      applyNote(result.note);
    } catch (nextError) { setError(nextError.message || '메모 이름을 변경하지 못했습니다.'); }
  }

  async function duplicateNote(note) {
    const target = await unlockNote(note, '복제');
    if (!target) return;
    try {
      const draft = draftFor(target);
      const result = await notesApi.create({ ...draft, title: `${draft.title} 복사본` });
      setNotes(items => [result.note, ...items]);
      setSelectedId(result.note.id);
    } catch (nextError) { setError(nextError.message || '메모를 복제하지 못했습니다.'); }
  }

  async function resetNotePassword(note) {
    if (user?.role !== 'admin' || !window.confirm(`${note.title}의 2차 암호를 초기화할까요?`)) return;
    try { await adminApi.resetNotePassword(note.id); await loadNotes(); setDraftNoteId(''); }
    catch (nextError) { setError(nextError.message || '메모 암호를 초기화하지 못했습니다.'); }
  }

  function openContextMenu(event, note = null) {
    event.preventDefault();
    event.stopPropagation();
    if (note && note.id !== selectedId) {
      if (isDirty) void saveNote();
      setSelectedId(note.id);
    }
    setContextMenu(noteContextMenu(event, note, {
      close: () => setContextMenu(null), create: createNote, refresh: loadNotes,
      rename: renameNote, duplicate: duplicateNote, saving,
      save: target => { const draft = draftFor(target); return saveNote(target.id, draft.title, draft.content); },
      setPassword: setNotePassword, clearPassword: clearNotePassword, unlock: unlockNote,
      remove: deleteSelectedNote, isAdmin: user?.role === 'admin', resetPassword: resetNotePassword
    }));
  }

  function submitPasswordDialog(password) {
    const resolve = passwordDialog?.resolve;
    setPasswordDialog(null);
    resolve?.(password);
  }

  function closePasswordDialog() {
    const resolve = passwordDialog?.resolve;
    setPasswordDialog(null);
    resolve?.("");
  }

  return (
    <div className="notes-page">
      <header className="notes-toolbar">
        <div className="feature-heading notes-title">
          <span className="feature-icon"><FileText size={20} /></span>
          <div>
            <h1>메모</h1>
            <span>{filteredNotes.length}개 메모</span>
          </div>
        </div>
        <Button icon={Plus} variant="primary" onClick={createNote}>새 메모</Button>
        <Button icon={RefreshCcw} iconOnly className="feature-refresh" onClick={loadNotes} disabled={busy}>새로고침</Button>
        <span className="toolbar-spacer" />
        <label className="search-box notes-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메모 검색" />
        </label>
      </header>

      {error ? <div className="error-banner page-error">{error}</div> : null}

      <div className="notes-layout">
        <aside className="notes-list-panel" aria-label="메모 목록" onContextMenu={event => openContextMenu(event)}>
          <div className="notes-list-summary">
            <span>{filteredNotes.length}개</span>
            {busy ? <Loader2 className="upload-spinner" size={16} /> : null}
          </div>
          {filteredNotes.length ? (
            <div className="notes-list">
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={note.id === selectedId ? "note-list-item selected" : "note-list-item"}
                  onClick={() => setSelectedId(note.id)}
                  onContextMenu={event => openContextMenu(event, note)}
                >
                  <strong>{note.title}</strong>
                  <span>{notePreview(note)}</span>
                  <small>{formatDate(note.updatedAt)}</small>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title={query.trim() ? "검색 결과가 없습니다" : "메모가 없습니다"}
              body={query.trim() ? "다른 검색어로 다시 찾아보세요." : "새 메모를 눌러 바로 작성하세요."}
              action={!query.trim() ? <Button icon={Plus} onClick={createNote}>새 메모</Button> : null}
            />
          )}
        </aside>

        <section className="notes-editor-panel" aria-label="메모 편집기" onContextMenu={event => openContextMenu(event, selectedNote)}>
          {selectedNote ? (
            <>
              <div className="notes-editor-top">
                <input
                  className="note-title-input"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onBlur={() => isDirty ? saveNote() : null}
                  placeholder="제목"
                  disabled={selectedNote.passwordProtected && !selectedNote.passwordUnlocked}
                />
                <div className="notes-editor-actions">
                  <span className={isDirty ? "note-save-state dirty" : "note-save-state"}>{saveStateLabel({ isDirty, saving, savedAt })}</span>
                  <Button icon={MoreHorizontal} iconOnly onClick={event => openContextMenu(event, selectedNote)}>메모 작업</Button>
                  <Button icon={LockKeyhole} onClick={() => setNotePassword()}>{selectedNote.passwordProtected ? "암호 변경" : "암호 설정"}</Button>
                  {selectedNote.passwordProtected ? <Button icon={UnlockKeyhole} onClick={() => clearNotePassword()}>암호 해제</Button> : null}
                  <Button onClick={() => saveNote()} disabled={!isDirty || saving}>저장</Button>
                  <Button icon={Trash2} iconOnly variant="danger" onClick={() => deleteSelectedNote()}>삭제</Button>
                </div>
              </div>
              {selectedNote.passwordProtected && !selectedNote.passwordUnlocked ? (
                <div className="note-locked-state">
                  <LockKeyhole size={34} />
                  <strong>암호가 필요한 메모입니다</strong>
                  <span>내용을 보거나 수정하려면 암호를 입력하세요.</span>
                  <Button icon={UnlockKeyhole} variant="primary" onClick={() => unlockNote(selectedNote, "열람")}>암호 입력</Button>
                </div>
              ) : (
                <textarea
                  className="note-content-textarea"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  placeholder="내용을 입력하세요"
                  spellCheck="true"
                />
              )}
            </>
          ) : (
            <EmptyState title="메모를 선택하세요" body="왼쪽 목록에서 메모를 선택하거나 새 메모를 만드세요." action={<Button icon={Plus} onClick={createNote}>새 메모</Button>} />
          )}
        </section>
      </div>
      {passwordDialog ? (
        <PasswordDialog
          title={passwordDialog.title}
          body={passwordDialog.body}
          confirmLabel={passwordDialog.confirmLabel}
          onSubmit={submitPasswordDialog}
          onClose={closePasswordDialog}
        />
      ) : null}
      <DriveContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}

function sortNotes(notes) {
  return [...notes].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function notePreview(note) {
  if (note.passwordProtected && !note.passwordUnlocked) return "암호 필요";
  const text = String(note.content || "").replace(/\s+/g, " ").trim();
  return text || "내용 없음";
}

function saveStateLabel({ isDirty, saving, savedAt }) {
  if (saving) return "저장 중";
  if (isDirty) return "저장 필요";
  if (savedAt) return "저장됨";
  return "자동 저장";
}
