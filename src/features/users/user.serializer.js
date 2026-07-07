export function serializeUser(user) {
  if (!user) return null;
  const quotaBytes = user.quota_bytes ?? user.quotaBytes ?? null;
  return {
    id: user.id,
    displayName: user.display_name ?? user.displayName ?? user.id,
    authProvider: user.auth_provider ?? user.authProvider ?? "password",
    googleEmail: user.google_email ?? user.googleEmail ?? null,
    role: user.role,
    quotaBytes,
    quotaMb: quotaBytes == null ? null : Math.round((quotaBytes / (1024 * 1024)) * 10) / 10,
    disabledAt: user.disabled_at ?? user.disabledAt ?? null,
    loginFailedCount: user.login_failed_count ?? user.loginFailedCount ?? 0,
    loginLockedUntil: user.login_locked_until ?? user.loginLockedUntil ?? null,
    loginSuspendedAt: user.login_suspended_at ?? user.loginSuspendedAt ?? null,
    createdAt: user.created_at ?? user.createdAt,
    updatedAt: user.updated_at ?? user.updatedAt,
    lastLoginAt: user.last_login_at ?? user.lastLoginAt ?? null
  };
}
