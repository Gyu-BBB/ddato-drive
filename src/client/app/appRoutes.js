import { matchPath } from "react-router";

export function normalizePathname(pathname) {
  return String(pathname || "/").replace(/\/+$/, "") || "/";
}

export function appPage(pathname) {
  const path = normalizePathname(pathname);
  if (path === "/" || matchPath("/folders/:folderId", path)) return "drive";
  if (["/media", "/notes", "/trash", "/shared", "/storage"].includes(path)) return path.slice(1);
  if (["/admin", "/admin/system", "/admin/users", "/admin/files", "/admin/audit"].includes(path)) return "admin";
  return null;
}

export function drivePath(folderId = "") {
  return folderId ? `/folders/${encodeURIComponent(folderId)}` : "/";
}

export function adminPath(tab = "system") {
  return tab === "system" ? "/admin" : `/admin/${tab}`;
}
