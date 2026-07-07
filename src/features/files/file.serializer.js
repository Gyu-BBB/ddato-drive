export function serializeFile(file, extra = {}) {
  return {
    id: file.id,
    ownerId: file.owner_id,
    parentId: file.parent_id,
    type: file.type,
    name: file.original_name,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
    folderColor: file.type === "folder" ? (file.folder_color || "yellow") : null,
    passwordProtected: Boolean(file.access_password_hash),
    ownPasswordProtected: Boolean(file.access_password_hash),
    passwordUnlocked: !file.access_password_hash,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    deletedAt: file.deleted_at,
    ...extra
  };
}
