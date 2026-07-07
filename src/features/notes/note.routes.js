import express from "express";
import { asyncRoute } from "../../core/http.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { requireUser } from "../auth/auth.middleware.js";
import { noteService } from "./NoteService.js";

export const notesRouter = express.Router();

notesRouter.get("/notes", requireUser, asyncRoute((req, res) => {
  res.json({ ok: true, notes: noteService.listNotes(req) });
}));

notesRouter.get("/notes/:id", requireUser, asyncRoute((req, res) => {
  res.json({ ok: true, note: noteService.getNote(req, req.params.id) });
}));

notesRouter.post("/notes", requireUser, asyncRoute((req, res) => {
  const note = noteService.createNote(req, req.body);
  auditLogger.record("note.create", req, note.id, { title: note.title });
  res.status(201).json({ ok: true, note });
}));

notesRouter.put("/notes/:id/password", requireUser, asyncRoute((req, res) => {
  const note = noteService.setAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("note.password.set", req, note.id);
  res.json({ ok: true, note });
}));

notesRouter.delete("/notes/:id/password", requireUser, asyncRoute((req, res) => {
  const note = noteService.clearAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("note.password.clear", req, note.id);
  res.json({ ok: true, note });
}));

notesRouter.post("/notes/:id/unlock", requireUser, asyncRoute((req, res) => {
  const note = noteService.unlockAccessPassword(req, req.params.id, req.body?.password);
  auditLogger.record("note.password.unlock", req, note.id);
  res.json({ ok: true, note });
}));

notesRouter.patch("/notes/:id", requireUser, asyncRoute((req, res) => {
  const note = noteService.updateNote(req, req.params.id, req.body);
  res.json({ ok: true, note });
}));

notesRouter.delete("/notes/:id", requireUser, asyncRoute((req, res) => {
  const result = noteService.deleteNote(req, req.params.id);
  auditLogger.record("note.delete", req, req.params.id);
  res.json({ ok: true, ...result });
}));
