import { TRASH_RETENTION_MS } from "../../shared/trashRetention.js";

export function serializeFile(file, extra = {}) {
  return {
    id: file.id,
    ownerId: file.owner_id,
    parentId: file.parent_id,
    type: file.type,
    name: file.original_name,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
    sourceModifiedAt: file.source_modified_at || null,
    capturedAt: file.captured_at || null,
    folderColor: file.type === "folder" ? (file.folder_color || "yellow") : null,
    passwordProtected: Boolean(file.access_password_hash),
    ownPasswordProtected: Boolean(file.access_password_hash),
    passwordUnlocked: !file.access_password_hash,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    deletedAt: file.deleted_at,
    trashExpiresAt: file.deleted_at == null ? null : file.deleted_at + TRASH_RETENTION_MS,
    ...extra
  };
}
