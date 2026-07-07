export function serializeNote(note, extra = {}) {
  return {
    id: note.id,
    userId: note.user_id,
    title: note.title,
    content: note.content,
    passwordProtected: Boolean(note.access_password_hash),
    passwordUnlocked: !note.access_password_hash,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    ...extra
  };
}
