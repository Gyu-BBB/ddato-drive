import { FileText, Loader2, LockKeyhole, Plus, RefreshCcw, Search, Trash2, UnlockKeyhole } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { PasswordDialog } from "../../shared/components/PasswordDialog.jsx";
import { formatDate } from "../../shared/lib/dates.js";
import { notesApi } from "./notesApi.js";

export function NotesPage() {
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
    if (selectedNote?.passwordProtected && !selectedNote.passwordUnlocked) {
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

  async function deleteSelectedNote() {
    if (!selectedNote) return;
    if (selectedNote.passwordProtected && !selectedNote.passwordUnlocked && !(await unlockNote(selectedNote, "삭제"))) return;
    if (!window.confirm(`${selectedNote.title} 메모를 삭제할까요?`)) return;
    setError("");
    try {
      await notesApi.remove(selectedNote.id);
      setNotes((items) => items.filter((note) => note.id !== selectedNote.id));
    } catch (nextError) {
      setError(nextError.message || "메모를 삭제하지 못했습니다.");
    }
  }

  async function setNotePassword() {
    if (!selectedNote) return;
    if (selectedNote.passwordProtected && !selectedNote.passwordUnlocked && !(await unlockNote(selectedNote, "암호 변경"))) return;
    const password = await requestPassword({
      title: selectedNote.passwordProtected ? "메모 암호 변경" : "메모 암호 설정",
      body: `${selectedNote.title} 메모에 사용할 암호를 입력하세요.`,
      confirmLabel: selectedNote.passwordProtected ? "암호 변경" : "암호 설정"
    });
    if (!password) return;
    try {
      const result = await notesApi.setPassword(selectedNote.id, password);
      applyNote(result.note);
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 설정하지 못했습니다.");
    }
  }

  async function clearNotePassword() {
    if (!selectedNote?.passwordProtected) return;
    const password = await requestPassword({
      title: "메모 암호 해제",
      body: `${selectedNote.title} 메모의 암호를 해제하려면 현재 암호를 입력하세요.`,
      confirmLabel: "암호 해제"
    });
    if (!password) return;
    try {
      const result = await notesApi.clearPassword(selectedNote.id, password);
      applyNote(result.note);
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 해제하지 못했습니다.");
    }
  }

  async function unlockNote(note = selectedNote, actionLabel = "열람") {
    if (!note?.passwordProtected || note.passwordUnlocked) return true;
    const password = await requestPassword({
      title: "메모 암호 입력",
      body: `${note.title} 메모를 ${actionLabel}하려면 암호가 필요합니다.`,
      confirmLabel: "잠금 해제"
    });
    if (!password) return false;
    try {
      const result = await notesApi.unlock(note.id, password);
      applyNote(result.note);
      return true;
    } catch (nextError) {
      setError(nextError.message || "메모 암호를 확인하지 못했습니다.");
      return false;
    }
  }

  function applyNote(note) {
    setNotes((items) => sortNotes(items.map((item) => item.id === note.id ? note : item)));
    if (selectedId === note.id) {
      setDraftNoteId(note.id);
      setDraftTitle(note.title);
      setDraftContent(note.content);
    }
  }

  function requestPassword(options) {
    return new Promise((resolve) => setPasswordDialog({ ...options, resolve }));
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
        <div className="notes-title">
          <FileText size={20} />
          <span>메모장</span>
        </div>
        <Button icon={Plus} variant="primary" onClick={createNote}>새 메모</Button>
        <Button icon={RefreshCcw} iconOnly onClick={loadNotes} disabled={busy}>새로고침</Button>
        <span className="toolbar-spacer" />
        <label className="search-box notes-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메모 검색" />
        </label>
      </header>

      {error ? <div className="error-banner page-error">{error}</div> : null}

      <div className="notes-layout">
        <aside className="notes-list-panel" aria-label="메모 목록">
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

        <section className="notes-editor-panel" aria-label="메모 편집기">
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
                  <Button icon={LockKeyhole} onClick={setNotePassword}>{selectedNote.passwordProtected ? "암호 변경" : "암호 설정"}</Button>
                  {selectedNote.passwordProtected ? <Button icon={UnlockKeyhole} onClick={clearNotePassword}>암호 해제</Button> : null}
                  <Button onClick={() => saveNote()} disabled={!isDirty || saving}>저장</Button>
                  <Button icon={Trash2} iconOnly variant="danger" onClick={deleteSelectedNote}>삭제</Button>
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
