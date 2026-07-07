export function serializeShare(share, url = "", { includePassword = false } = {}) {
  if (!share) return null;
  const serialized = {
    id: share.id,
    fileId: share.file_id,
    ownerId: share.owner_id,
    mode: share.mode,
    token: share.token,
    url,
    expiresAt: share.expires_at,
    passwordEnabled: Boolean(share.access_password_hash),
    revokedAt: share.revoked_at,
    createdBy: share.created_by,
    createdAt: share.created_at,
    updatedAt: share.updated_at
  };
  if (includePassword) serialized.password = share.access_password_plain || "";
  return serialized;
}
