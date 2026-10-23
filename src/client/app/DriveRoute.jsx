import { useEffect, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { DrivePage } from "../features/files/DrivePage.jsx";
import { filesApi } from "../features/files/filesApi.js";
import { drivePath, normalizePathname } from "./appRoutes.js";

export function DriveRoute({ ownerId = "", trashMode = false, ...props }) {
  const location = useLocation();
  const navigate = useNavigate();
  const adminFiles = normalizePathname(location.pathname) === "/admin/files";
  const folderId = trashMode ? "" : adminFiles
    ? new URLSearchParams(location.search).get("folder") || ""
    : matchPath("/folders/:folderId", location.pathname)?.params.folderId || "";
  const key = JSON.stringify([ownerId, folderId]);
  const [resolved, setResolved] = useState(() => ({ key: folderId ? null : key, stack: [], error: "" }));
  const ready = resolved.key === key;

  useEffect(() => {
    if (ready) return;
    if (!folderId) {
      setResolved({ key, stack: [], error: "" });
      return;
    }
    let active = true;
    filesApi.get(folderId).then(({ file }) => {
      if (file.type !== "folder" || (ownerId && file.ownerId !== ownerId)) throw new Error("폴더를 찾을 수 없습니다.");
      if (active) setResolved({ key, stack: file.path, error: "" });
    }).catch(error => {
      if (active) setResolved({ key, stack: [], error: error.message || "폴더를 열지 못했습니다." });
    });
    return () => { active = false; };
  }, [key, folderId, ownerId, ready]);

  function navigateFolder(stack) {
    const nextId = stack.at(-1)?.id || "";
    let destination = drivePath(nextId);
    if (adminFiles) {
      const params = new URLSearchParams(location.search);
      params.set("owner", ownerId);
      if (nextId) params.set("folder", nextId);
      else params.delete("folder");
      destination = `${location.pathname}?${params}`;
    }
    setResolved({ key: JSON.stringify([ownerId, nextId]), stack, error: "" });
    if (destination !== `${location.pathname}${location.search}`) navigate(destination);
  }

  return <DrivePage {...props} ownerId={ownerId} trashMode={trashMode}
    routeFolderId={folderId} routedFolderStack={ready ? resolved.stack : []}
    folderLoading={!ready} folderError={ready ? resolved.error : ""} onFolderNavigate={navigateFolder} />;
}
