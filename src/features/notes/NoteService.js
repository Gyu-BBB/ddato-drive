import crypto from "node:crypto";
import { fail } from "../../core/errors.js";
import { accessPasswordService } from "../protection/AccessPasswordService.js";
import { noteRepository } from "./NoteRepository.js";
import { serializeNote } from "./note.serializer.js";

const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 200_000;

export class NoteService {
  listNotes(req) {
    return noteRepository.listByUser(req.user.id).map((note) => this.serializeNoteForRequest(req, note));
  }

  getNote(req, noteId) {
    const note = this.getOwnedNote(req.user, noteId);
    accessPasswordService.assertNoteAccess(req, note);
    return this.serializeNoteForRequest(req, note, { content: note.content });
  }

  createNote(req, payload = {}) {
    const content = normalizeContent(payload.content);
    const title = normalizeTitle(payload.title, content);
    return this.serializeNoteForRequest(req, noteRepository.create({
      id: crypto.randomUUID(),
      userId: req.user.id,
      title,
      content
    }));
  }

  updateNote(req, noteId, payload = {}) {
    const note = this.getOwnedNote(req.user, noteId);
    accessPasswordService.assertNoteAccess(req, note);
    const content = normalizeContent(payload.content);
    const title = normalizeTitle(payload.title, content);
    return this.serializeNoteForRequest(req, noteRepository.update(req.user.id, noteId, { title, content }));
  }

  deleteNote(req, noteId) {
    const note = this.getOwnedNote(req.user, noteId);
    noteRepository.delete(req.user.id, noteId);
    return { deleted: true, id: noteId };
  }

  setAccessPassword(req, noteId, password) {
    const note = this.getOwnedNote(req.user, noteId);
    if (note.access_password_hash) {
      accessPasswordService.assertNoteAccess(req, note);
    }
    const updated = noteRepository.setAccessPassword(req.user.id, note.id, accessPasswordService.hash(password));
    accessPasswordService.revokeUnlocksForResource(updated.id);
    return this.serializeNoteForRequest(req, updated);
  }

  clearAccessPassword(req, noteId, password) {
    const note = this.getOwnedNote(req.user, noteId);
    if (!note.access_password_hash) return this.serializeNoteForRequest(req, note);
    if (!accessPasswordService.verify(password, note.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "note" });
    }
    return this.serializeNoteForRequest(req, noteRepository.clearAccessPassword(req.user.id, note.id));
  }

  resetAccessPasswordAsAdmin(req, noteId) {
    const id = String(noteId || "").trim();
    if (!id) fail(400, "메모를 찾을 수 없습니다.");
    const note = noteRepository.findAnyById(id);
    if (!note) fail(404, "메모를 찾을 수 없습니다.");
    if (!note.access_password_hash) {
      return serializeNote(note, {
        ...accessPasswordService.serializeNoteProtection(req, note),
        content: ""
      });
    }
    const cleared = noteRepository.clearAccessPassword(note.user_id, note.id);
    accessPasswordService.revokeUnlocksForResource(note.id);
    return serializeNote(cleared, {
      ...accessPasswordService.serializeNoteProtection(req, cleared),
      content: ""
    });
  }

  unlockAccessPassword(req, noteId, password) {
    const note = this.getOwnedNote(req.user, noteId);
    accessPasswordService.unlockNote(req, note, password);
    return this.serializeNoteForRequest(req, note, { content: note.content });
  }

  getOwnedNote(user, noteId) {
    const id = String(noteId || "").trim();
    if (!id) fail(400, "메모를 찾을 수 없습니다.");
    const note = noteRepository.findById(user.id, id);
    if (!note) fail(404, "메모를 찾을 수 없습니다.");
    return note;
  }

  serializeNoteForRequest(req, note, extra = {}) {
    const protection = accessPasswordService.serializeNoteProtection(req, note);
    return serializeNote(note, {
      ...protection,
      content: protection.passwordUnlocked ? note.content : "",
      ...extra
    });
  }
}

export const noteService = new NoteService();

function normalizeTitle(value, content = "") {
  const requestedTitle = String(value || "").normalize("NFKC").trim();
  const contentTitle = String(content || "").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
  const title = requestedTitle || contentTitle || "제목 없음";
  return title.slice(0, MAX_TITLE_LENGTH);
}

function normalizeContent(value) {
  const content = String(value || "").replace(/\r\n/g, "\n");
  if (content.length > MAX_CONTENT_LENGTH) {
    fail(413, "메모가 너무 깁니다.", {
      code: "note_too_large",
      maxLength: MAX_CONTENT_LENGTH
    });
  }
  return content;
}
