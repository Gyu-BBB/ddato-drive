import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, ".tmp", `smoke-${Date.now()}`);
const port = 45117 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

let server = null;

try {
  fs.mkdirSync(dataDir, { recursive: true });
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DDATO_DRIVE_PORT: String(port),
      DDATO_DRIVE_DATA_DIR: dataDir,
      DDATO_DRIVE_TRUST_PROXY: "0",
      DDATO_DRIVE_GOOGLE_CLIENT_ID: "",
      DDATO_DRIVE_GOOGLE_CLIENT_SECRET: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  await waitForHealth();
  const health = await rawRequest("/api/health");
  assert(String(health.headers.get("content-security-policy") || "").includes("default-src 'self'"), "CSP header is missing");
  const serviceWorker = await rawRequest("/service-worker.js");
  assert(String(serviceWorker.headers.get("content-type") || "").includes("application/javascript"), "service worker cleanup script should be JavaScript");
  assert((await serviceWorker.text()).includes("registration.unregister"), "service worker cleanup script should unregister old workers");
  const googleStatus = await request("/api/auth/google/status");
  assert(googleStatus.enabled === false, "Google login should be disabled without credentials");
  const googleStart = await rawRequest("/api/auth/google");
  assert(googleStart.status === 503, "Google login start should require credentials");

  const adminJar = {};
  const admin = await request("/api/auth/login", {
    method: "POST",
    body: { id: "admin", password: "123456" },
    jar: adminJar
  });
  assert(admin.user.role === "admin", "admin login did not return admin role");

  for (let index = 0; index < 5; index += 1) {
    const failedAdminLogin = await rawRequest("/api/auth/login", {
      method: "POST",
      body: { id: "admin", password: `wrong-${index}` }
    });
    assert(failedAdminLogin.status === 401, "bootstrap admin should not be web-locked by bad passwords");
  }
  const adminStillWorks = await request("/api/auth/login", {
    method: "POST",
    body: { id: "admin", password: "123456" },
    jar: {}
  });
  assert(adminStillWorks.user.role === "admin", "bootstrap admin could not log in after failed attempts");

  const publicRegister = await rawRequest("/api/auth/register", {
    method: "POST",
    body: { id: "public_register", password: "pw" }
  });
  assert(publicRegister.status === 410, "public password registration should be disabled");

  const initialSystem = await request("/api/admin/system", { jar: adminJar });
  assert(initialSystem.system.settings.defaultQuotaBytes === 1024 * 1024 * 1024, "initial default quota is not 1GB");
  const updatedDefaultQuota = await request("/api/admin/settings/default-quota", {
    method: "PATCH",
    body: { quotaMb: 256 },
    jar: adminJar
  });
  assert(updatedDefaultQuota.settings.defaultQuotaBytes === 256 * 1024 * 1024, "admin could not update default quota");
  const defaultQuotaUserId = `default_quota_${Date.now()}`;
  const defaultQuotaUser = await request("/api/admin/users", {
    method: "POST",
    body: { id: defaultQuotaUserId, password: "pw" },
    jar: adminJar
  });
  assert(defaultQuotaUser.user.quotaBytes === 256 * 1024 * 1024, "admin-created user did not use updated default quota");
  await request("/api/admin/settings/default-quota", {
    method: "PATCH",
    body: { quotaMb: 1024 },
    jar: adminJar
  });

  const userJar = {};
  const userId = `smoke_${Date.now()}`;
  const createdSmokeUser = await request("/api/admin/users", {
    method: "POST",
    body: { id: userId, password: "pw", quotaMb: 1024 },
    jar: adminJar
  });
  assert(createdSmokeUser.user.quotaBytes === 1024 * 1024 * 1024, "default quota is not 1GB");
  const registered = await request("/api/auth/login", {
    method: "POST",
    body: { id: userId, password: "pw" },
    jar: userJar
  });
  assert(registered.user.quotaBytes === 1024 * 1024 * 1024, "default quota is not 1GB");

  const profile = await request("/api/auth/profile", {
    method: "PATCH",
    body: { displayName: "Smoke User", password: "pw2" },
    jar: userJar
  });
  assert(profile.user.displayName === "Smoke User", "profile display name was not updated");

  const reloginJar = {};
  const relogin = await request("/api/auth/login", {
    method: "POST",
    body: { id: userId, password: "pw2" },
    jar: reloginJar
  });
  assert(relogin.user.id === userId, "updated password did not work");

  const crossSiteCreate = await rawRequest("/api/folders", {
    method: "POST",
    body: { name: "cross-site" },
    jar: userJar,
    headers: { origin: "https://evil.example" }
  });
  assert(crossSiteCreate.status === 403, "cross-site mutating request should be rejected");

  const unauthNotes = await rawRequest("/api/notes");
  assert(unauthNotes.status === 401, "notes API should require authentication");
  const emptyNotes = await request("/api/notes", { jar: userJar });
  assert(Array.isArray(emptyNotes.notes), "notes list response mismatch");
  const createdNote = await request("/api/notes", {
    method: "POST",
    body: { title: "Smoke Memo", content: "first line" },
    jar: userJar
  });
  assert(createdNote.note.title === "Smoke Memo", "note create title mismatch");
  const updatedNote = await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}`, {
    method: "PATCH",
    body: { title: "Updated Memo", content: "changed content" },
    jar: userJar
  });
  assert(updatedNote.note.content === "changed content", "note update content mismatch");
  const protectedNote = await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "PUT",
    body: { password: "note-secret" },
    jar: userJar
  });
  assert(protectedNote.note.passwordProtected === true, "note password was not set");
  assert(protectedNote.note.passwordUnlocked === false, "note should lock immediately after password is set");
  const lockedNoteList = await request("/api/notes", { jar: userJar });
  const lockedNote = lockedNoteList.notes.find((note) => note.id === createdNote.note.id);
  assert(lockedNote.passwordProtected === true, "locked note did not serialize password state");
  assert(lockedNote.content === "", "locked note list should not expose content");
  const lockedNoteUpdate = await rawRequest(`/api/notes/${encodeURIComponent(createdNote.note.id)}`, {
    method: "PATCH",
    body: { title: "Should Block", content: "blocked" },
    jar: userJar
  });
  assert(lockedNoteUpdate.status === 423, "locked note update should require password");
  const unlockedNote = await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}/unlock`, {
    method: "POST",
    body: { password: "note-secret" },
    jar: userJar
  });
  assert(unlockedNote.note.content === "changed content", "note unlock did not return content");
  await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "PUT",
    body: { password: "note-reset-secret" },
    jar: userJar
  });
  const userNoteResetAttempt = await rawRequest(`/api/admin/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "DELETE",
    jar: userJar
  });
  assert(userNoteResetAttempt.status === 403, "non-admin reset note password should be rejected");
  const adminResetNote = await request(`/api/admin/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "DELETE",
    jar: adminJar
  });
  assert(adminResetNote.note.passwordProtected === false, "admin did not reset note password");
  const noteAfterAdminReset = await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}`, { jar: userJar });
  assert(noteAfterAdminReset.note.content === "changed content", "note should be readable after admin password reset");
  await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "PUT",
    body: { password: "note-secret" },
    jar: userJar
  });
  const clearedNote = await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}/password`, {
    method: "DELETE",
    body: { password: "note-secret" },
    jar: userJar
  });
  assert(clearedNote.note.passwordProtected === false, "note password was not cleared");
  const listedNotes = await request("/api/notes", { jar: userJar });
  assert(listedNotes.notes.some((note) => note.id === createdNote.note.id && note.title === "Updated Memo"), "notes list missing updated note");
  const adminNotes = await request("/api/notes", { jar: adminJar });
  assert(!adminNotes.notes.some((note) => note.id === createdNote.note.id), "notes leaked across users");
  await request(`/api/notes/${encodeURIComponent(createdNote.note.id)}`, {
    method: "DELETE",
    jar: userJar
  });
  const notesAfterDelete = await request("/api/notes", { jar: userJar });
  assert(!notesAfterDelete.notes.some((note) => note.id === createdNote.note.id), "deleted note still listed");

  const forgottenNote = await request('/api/notes', { method: 'POST', body: { title: 'Forgotten password note', content: 'private content' }, jar: userJar });
  await request(`/api/notes/${forgottenNote.note.id}/password`, { method: 'PUT', body: { password: 'forgotten' }, jar: userJar });
  const otherNoteDelete = await rawRequest(`/api/notes/${forgottenNote.note.id}`, { method: 'DELETE', jar: adminJar });
  assert(otherNoteDelete.status === 404 || otherNoteDelete.status === 403, 'password-free note delete must still require ownership');
  const forgottenNoteDelete = await request(`/api/notes/${forgottenNote.note.id}`, { method: 'DELETE', jar: userJar });
  assert(forgottenNoteDelete.deleted === true, 'locked note should delete without its password');

  const form = new FormData();
  form.set("file", new Blob(["hello ddato drive"], { type: "text/plain" }), "hello.txt");
  const uploaded = await request("/api/files/upload", {
    method: "POST",
    body: form,
    jar: userJar
  });
  assert(uploaded.file.name === "hello.txt", "upload name mismatch");

  const resumed = await request("/api/files/upload-sessions", {
    method: "POST", body: { name: "resume-check.txt", sizeBytes: 6, mimeType: "text/plain" }, jar: userJar
  });
  assert(resumed.session.chunkSizeBytes > 0, "server should advertise its chunk limit");
  const chunkRequest = (offset, data) => fetch(`${baseUrl}/api/files/upload-sessions/${resumed.session.id}/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": String(offset), cookie: Object.entries(userJar).map(([key, value]) => `${key}=${value}`).join("; ") },
    body: data
  });
  const duplicates = await Promise.all([chunkRequest(0, "abc"), chunkRequest(0, "abc")]);
  assert(duplicates.every(response => response.status === 200), "concurrent duplicate chunks should be idempotent");
  const resumeStatus = await request(`/api/files/upload-sessions/${resumed.session.id}`, { jar: userJar });
  assert(resumeStatus.session.uploadedBytes === 3, "resume offset should not duplicate concurrent bytes");
  const lastChunk = await chunkRequest(3, "def");
  assert(lastChunk.status === 200, "resuming upload should accept server offset");
  const resumedFile = await request(`/api/files/upload-sessions/${resumed.session.id}/complete`, { method: "POST", jar: userJar });
  const resumedDownload = await rawRequest(`/api/files/${resumedFile.file.id}/download`, { jar: userJar });
  assert((await resumedDownload.text()) === "abcdef", "async resumed upload changed file contents");

  const macUploadName = "한글 문서.txt".normalize("NFD");
  const macExpectedName = "한글 문서.txt";
  const macNameForm = new FormData();
  macNameForm.set("file", new Blob(["mac filename"], { type: "text/plain" }), macUploadName);
  const macNameUpload = await request("/api/files/upload", {
    method: "POST",
    body: macNameForm,
    jar: userJar
  });
  assert(macNameUpload.file.name === macExpectedName, "macOS decomposed Korean filename was not normalized");

  const macNameDownload = await rawRequest(`/api/files/${macNameUpload.file.id}/download`, { jar: userJar });
  assert(macNameDownload.status === 200, "macOS filename download failed");
  assert(
    String(macNameDownload.headers.get("content-disposition") || "").includes(encodeRfc5987FileName(macExpectedName)),
    "download header did not include UTF-8 normalized filename"
  );

  const reservedNameForm = new FormData();
  reservedNameForm.set("file", new Blob(["reserved"], { type: "text/plain" }), "CON.txt");
  const reservedNameUpload = await request("/api/files/upload", {
    method: "POST",
    body: reservedNameForm,
    jar: userJar
  });
  assert(reservedNameUpload.file.name === "CON_.txt", "Windows reserved filename was not made safe");

  const listing = await request("/api/files", { jar: userJar });
  assert(listing.files.length >= 3, "file list did not include uploads");

  const preview = await rawRequest(`/api/files/${uploaded.file.id}/preview`, { jar: userJar });
  assert(preview.status === 200, "preview failed");
  assert((await preview.text()) === "hello ddato drive", "preview content mismatch");

  const protectedFile = await request(`/api/files/${uploaded.file.id}/password`, {
    method: "PUT",
    body: { password: "file-secret" },
    jar: userJar
  });
  assert(protectedFile.file.passwordProtected === true, "file password was not set");
  assert(protectedFile.file.passwordUnlocked === false, "file should lock immediately after password is set");
  const lockedMediaForm = new FormData();
  lockedMediaForm.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'locked-media.png');
  const lockedMediaUpload = await request('/api/files/upload', { method: 'POST', body: lockedMediaForm, jar: userJar });
  await request(`/api/files/${lockedMediaUpload.file.id}/password`, { method: 'PUT', body: { password: 'media-secret' }, jar: userJar });
  const mediaBeforeUnlock = await request('/api/files/media', { jar: userJar });
  const lockedMediaItem = mediaBeforeUnlock.files.find(file => file.id === lockedMediaUpload.file.id);
  assert(lockedMediaItem?.passwordProtected === true && lockedMediaItem.passwordUnlocked === false, 'media listing should identify locked files');
  const blockedMediaPreview = await rawRequest(`/api/files/${lockedMediaUpload.file.id}/preview`, { jar: userJar });
  assert(blockedMediaPreview.status === 423, 'locked media preview must remain protected');
  await request(`/api/files/${lockedMediaUpload.file.id}/unlock`, { method: 'POST', body: { password: 'media-secret' }, jar: userJar });
  const mediaAfterUnlock = await request('/api/files/media', { jar: userJar });
  assert(mediaAfterUnlock.files.find(file => file.id === lockedMediaUpload.file.id)?.passwordUnlocked === true, 'media listing should refresh its unlock state');
  const allowedMediaPreview = await rawRequest(`/api/files/${lockedMediaUpload.file.id}/preview`, { jar: userJar });
  assert(allowedMediaPreview.status === 200, 'unlocked media should preview normally');
  await request(`/api/files/${lockedMediaUpload.file.id}`, { method: 'DELETE', jar: userJar });
  const lockedPreview = await rawRequest(`/api/files/${uploaded.file.id}/preview`, { jar: userJar });
  assert(lockedPreview.status === 423, "locked file preview should require password");
  const lockedShareCreate = await rawRequest(`/api/files/${uploaded.file.id}/share`, {
    method: "POST",
    body: { mode: "hour" },
    jar: userJar
  });
  assert(lockedShareCreate.status === 423, "locked file share creation should require password");
  const lockedRename = await rawRequest(`/api/files/${uploaded.file.id}/rename`, {
    method: "PATCH",
    body: { name: "renamed-while-locked.txt" },
    jar: userJar
  });
  assert(lockedRename.status === 423, "locked file rename should require password");
  const lockedDuplicate = await rawRequest(`/api/files/${uploaded.file.id}/duplicate`, {
    method: "POST",
    jar: userJar
  });
  assert(lockedDuplicate.status === 423, "locked file duplicate should require password");
  const lockedDelete = await rawRequest(`/api/files/${uploaded.file.id}`, {
    method: "DELETE",
    jar: userJar
  });
  assert(lockedDelete.status === 200, "locked file should be deletable without its password");
  await request(`/api/trash/${uploaded.file.id}/restore`, { method: "POST", jar: userJar });
  const restoredLockedPreview = await rawRequest(`/api/files/${uploaded.file.id}/preview`, { jar: userJar });
  assert(restoredLockedPreview.status === 423, "restoring a locked file must preserve its password");
  const unauthenticatedDelete = await rawRequest(`/api/files/${uploaded.file.id}`, { method: 'DELETE' });
  assert(unauthenticatedDelete.status === 401, 'password-free deletion must still require login');

  const deleteGuardId = `delete_guard_${Date.now()}`;
  await request('/api/admin/users', { method: 'POST', body: { id: deleteGuardId, password: 'guard', quotaMb: 1 }, jar: adminJar });
  const deleteGuardJar = {};
  await request('/api/auth/login', { method: 'POST', body: { id: deleteGuardId, password: 'guard' }, jar: deleteGuardJar });
  const foreignDelete = await rawRequest(`/api/files/${uploaded.file.id}`, { method: 'DELETE', jar: deleteGuardJar });
  assert(foreignDelete.status === 403, 'password-free file delete must not permit another user to delete files');

  const forgottenFolder = await request('/api/folders', { method: 'POST', body: { name: 'Forgotten folder password' }, jar: userJar });
  const forgottenChildForm = new FormData();
  forgottenChildForm.set('parentId', forgottenFolder.file.id);
  forgottenChildForm.set('file', new Blob(['locked child']), 'child.txt');
  const forgottenChild = await request('/api/files/upload', { method: 'POST', body: forgottenChildForm, jar: userJar });
  const forgottenShare = await request(`/api/files/${forgottenFolder.file.id}/share`, { method: 'POST', body: { mode: 'permanent' }, jar: userJar });
  await request(`/api/files/${forgottenChild.file.id}/password`, { method: 'PUT', body: { password: 'child-password' }, jar: userJar });
  await request(`/api/files/${forgottenFolder.file.id}/password`, { method: 'PUT', body: { password: 'folder-password' }, jar: userJar });
  const forgottenFolderDelete = await request(`/api/files/${forgottenFolder.file.id}`, { method: 'DELETE', jar: userJar });
  assert(forgottenFolderDelete.deleted === 2, 'locked folder and locked children should delete without passwords');
  const deletedFolderShare = await rawRequest(`/api/shares/${forgottenShare.share.token}`);
  assert(deletedFolderShare.status === 404, 'deleting locked folders must revoke their shares');
  await request(`/api/trash/${forgottenFolder.file.id}/restore`, { method: 'POST', jar: userJar });
  const restoredChildDownload = await rawRequest(`/api/files/${forgottenChild.file.id}/download`, { jar: userJar });
  assert(restoredChildDownload.status === 423, 'restored children must still require passwords to download');
  await request(`/api/files/${forgottenFolder.file.id}`, { method: 'DELETE', jar: userJar });
  const forgottenPurge = await request(`/api/trash/${forgottenFolder.file.id}`, { method: 'DELETE', jar: userJar });
  assert(forgottenPurge.purged === 2, 'locked trash items must support permanent deletion without passwords');
  const lockedMoveTarget = await request("/api/folders", {
    method: "POST",
    body: { name: "Locked Move Target" },
    jar: userJar
  });
  const lockedMove = await rawRequest(`/api/files/${uploaded.file.id}/move`, {
    method: "PATCH",
    body: { parentId: lockedMoveTarget.file.id },
    jar: userJar
  });
  assert(lockedMove.status === 423, "locked file move should require password");
  const userFileResetAttempt = await rawRequest(`/api/admin/files/${uploaded.file.id}/password`, {
    method: "DELETE",
    jar: userJar
  });
  assert(userFileResetAttempt.status === 403, "non-admin reset file password should be rejected");
  const adminResetFile = await request(`/api/admin/files/${uploaded.file.id}/password`, {
    method: "DELETE",
    jar: adminJar
  });
  assert(adminResetFile.file.passwordProtected === false, "admin did not reset file password");
  const resetPreview = await rawRequest(`/api/files/${uploaded.file.id}/preview`, { jar: userJar });
  assert(resetPreview.status === 200, "file should be readable after admin password reset");
  await request(`/api/files/${uploaded.file.id}/password`, {
    method: "PUT",
    body: { password: "file-secret" },
    jar: userJar
  });
  const unlockedFile = await request(`/api/files/${uploaded.file.id}/unlock`, {
    method: "POST",
    body: { password: "file-secret" },
    jar: userJar
  });
  assert(unlockedFile.file.passwordUnlocked === true, "file unlock did not mark unlocked");
  const unlockedPreview = await rawRequest(`/api/files/${uploaded.file.id}/preview`, { jar: userJar });
  assert(unlockedPreview.status === 200, "unlocked file preview failed");
  await request(`/api/files/${uploaded.file.id}/password`, {
    method: "DELETE",
    body: { password: "file-secret" },
    jar: userJar
  });

  const svgForm = new FormData();
  svgForm.set("file", new Blob(["<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"], { type: "image/svg+xml" }), "unsafe.svg");
  const svgUpload = await request("/api/files/upload", {
    method: "POST",
    body: svgForm,
    jar: userJar
  });
  const svgPreview = await rawRequest(`/api/files/${svgUpload.file.id}/preview`, { jar: userJar });
  assert(svgPreview.status === 415, "SVG preview should be blocked");

  const imageForm = new FormData();
  imageForm.set("file", new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "photo.png");
  const imageUpload = await request("/api/files/upload", {
    method: "POST",
    body: imageForm,
    jar: userJar
  });
  const videoForm = new FormData();
  videoForm.set("file", new Blob(["video-placeholder"], { type: "video/mp4" }), "clip.mp4");
  const videoUpload = await request("/api/files/upload", {
    method: "POST",
    body: videoForm,
    jar: userJar
  });
  const mediaListing = await request("/api/files/media", { jar: userJar });
  assert(mediaListing.files.some((file) => file.id === imageUpload.file.id && file.mediaKind === "image"), "media listing did not include image file");
  assert(mediaListing.files.some((file) => file.id === videoUpload.file.id && file.mediaKind === "video"), "media listing did not include video file");
  assert(!mediaListing.files.some((file) => file.id === svgUpload.file.id), "media listing should not include blocked SVG files");

  const hourShare = await request(`/api/files/${uploaded.file.id}/share`, {
    method: "POST",
    body: { mode: "hour" },
    jar: userJar
  });
  assert(hourShare.share.mode === "hour", "hour share mode mismatch");
  assert(hourShare.share.expiresAt > Date.now(), "hour share did not expire in the future");
  assert(hourShare.share.url.includes(`/share/${hourShare.share.token}`), "hour share URL mismatch");

  const publicShare = await request(`/api/shares/${encodeURIComponent(hourShare.share.token)}`);
  assert(publicShare.file.id === uploaded.file.id, "public share did not return uploaded file");

  const publicPreview = await rawRequest(`/api/shares/${encodeURIComponent(hourShare.share.token)}/preview`);
  assert(publicPreview.status === 200, "public preview failed");
  assert((await publicPreview.text()) === "hello ddato drive", "public preview content mismatch");

  const passwordShare = await request(`/api/files/${uploaded.file.id}/share`, {
    method: "POST",
    body: { mode: "hour", password: "link-secret" },
    jar: userJar
  });
  assert(passwordShare.share.passwordEnabled === true, "password share did not report password enabled");
  assert(passwordShare.share.password === "link-secret", "share owner could not see the share password");
  const activePasswordShare = await request(`/api/files/${uploaded.file.id}/share`, { jar: userJar });
  assert(activePasswordShare.share.password === "link-secret", "active share did not return owner-visible password");
  const passwordPublicInfo = await request(`/api/shares/${encodeURIComponent(passwordShare.share.token)}`);
  assert(passwordPublicInfo.passwordRequired === true, "password-protected share should require password");
  assert(!Object.hasOwn(passwordPublicInfo.share, "password"), "public share response leaked the password");
  const passwordPublicPreview = await rawRequest(`/api/shares/${encodeURIComponent(passwordShare.share.token)}/preview`);
  assert(passwordPublicPreview.status === 423, "password-protected public preview should require password");
  await request(`/api/shares/${encodeURIComponent(passwordShare.share.token)}/unlock`, {
    method: "POST",
    body: { password: "link-secret" }
  });
  const unlockedPasswordPublicPreview = await rawRequest(`/api/shares/${encodeURIComponent(passwordShare.share.token)}/preview`);
  assert(unlockedPasswordPublicPreview.status === 200, "unlocked password share preview failed");
  assert((await unlockedPasswordPublicPreview.text()) === "hello ddato drive", "unlocked password share content mismatch");

  const protectedShareForm = new FormData();
  protectedShareForm.set("file", new Blob(["protected share"], { type: "text/plain" }), "protected-share.txt");
  const protectedShareUpload = await request("/api/files/upload", {
    method: "POST",
    body: protectedShareForm,
    jar: userJar
  });
  await request(`/api/files/${protectedShareUpload.file.id}/password`, {
    method: "PUT",
    body: { password: "share-secret" },
    jar: userJar
  });
  await request(`/api/files/${protectedShareUpload.file.id}/unlock`, {
    method: "POST",
    body: { password: "share-secret" },
    jar: userJar
  });
  const protectedShare = await request(`/api/files/${protectedShareUpload.file.id}/share`, {
    method: "POST",
    body: { mode: "hour" },
    jar: userJar
  });
  const protectedPublicInfo = await request(`/api/shares/${encodeURIComponent(protectedShare.share.token)}`);
  assert(protectedPublicInfo.passwordRequired === true, "protected public share should require password");
  const protectedPublicPreview = await rawRequest(`/api/shares/${encodeURIComponent(protectedShare.share.token)}/preview`);
  assert(protectedPublicPreview.status === 423, "protected public preview should require password");
  await request(`/api/shares/${encodeURIComponent(protectedShare.share.token)}/unlock`, {
    method: "POST",
    body: { password: "share-secret" }
  });
  const unlockedPublicPreview = await rawRequest(`/api/shares/${encodeURIComponent(protectedShare.share.token)}/preview`);
  assert(unlockedPublicPreview.status === 200, "unlocked public preview failed");
  assert((await unlockedPublicPreview.text()) === "protected share", "unlocked public preview content mismatch");

  const folder = await request("/api/folders", {
    method: "POST",
    body: { name: "Documents" },
    jar: userJar
  });
  assert(folder.file.type === "folder", "folder create did not return a folder");

  const lockedFolder = await request("/api/folders", {
    method: "POST",
    body: { name: "Locked Governance" },
    jar: userJar
  });
  await request(`/api/files/${lockedFolder.file.id}/password`, {
    method: "PUT",
    body: { password: "folder-secret" },
    jar: userJar
  });
  const lockedBulkDownload = await rawRequest("/api/files/download", {
    method: "POST",
    body: { ids: [uploaded.file.id, lockedFolder.file.id] },
    jar: userJar
  });
  assert(lockedBulkDownload.status === 423, "bulk download should require password when a selected item is locked");
  const lockedFolderColor = await rawRequest(`/api/folders/${lockedFolder.file.id}/color`, {
    method: "PATCH",
    body: { color: "blue" },
    jar: userJar
  });
  assert(lockedFolderColor.status === 423, "locked folder color change should require password");
  const lockedFolderCreate = await rawRequest("/api/folders", {
    method: "POST",
    body: { name: "Should Not Create", parentId: lockedFolder.file.id },
    jar: userJar
  });
  assert(lockedFolderCreate.status === 423, "creating inside a locked folder should require password");
  const lockedFolderUploadForm = new FormData();
  lockedFolderUploadForm.set("parentId", lockedFolder.file.id);
  lockedFolderUploadForm.set("file", new Blob(["blocked"], { type: "text/plain" }), "blocked.txt");
  const lockedFolderUpload = await rawRequest("/api/files/upload", {
    method: "POST",
    body: lockedFolderUploadForm,
    jar: userJar
  });
  assert(lockedFolderUpload.status === 423, "uploading into a locked folder should require password");
  const lockedFolderSession = await rawRequest("/api/files/upload-sessions", {
    method: "POST",
    body: { parentId: lockedFolder.file.id, name: "blocked-session.txt", sizeBytes: 4, mimeType: "text/plain" },
    jar: userJar
  });
  assert(lockedFolderSession.status === 423, "resumable upload into a locked folder should require password");
  const moveIntoLockedFolder = await rawRequest(`/api/files/${uploaded.file.id}/move`, {
    method: "PATCH",
    body: { parentId: lockedFolder.file.id },
    jar: userJar
  });
  assert(moveIntoLockedFolder.status === 423, "moving into a locked folder should require password");

  const nestedForm = new FormData();
  nestedForm.set("parentId", folder.file.id);
  nestedForm.set("file", new Blob(["inside shared folder"], { type: "text/plain" }), "nested.txt");
  const nestedUpload = await request("/api/files/upload", {
    method: "POST",
    body: nestedForm,
    jar: userJar
  });
  assert(nestedUpload.file.parentId === folder.file.id, "nested upload parent mismatch");

  const nestedMacName = "맥 자료.txt".normalize("NFD");
  const nestedMacExpectedName = "맥 자료.txt";
  const nestedMacForm = new FormData();
  nestedMacForm.set("parentId", folder.file.id);
  nestedMacForm.set("file", new Blob(["inside shared folder with mac name"], { type: "text/plain" }), nestedMacName);
  const nestedMacUpload = await request("/api/files/upload", {
    method: "POST",
    body: nestedMacForm,
    jar: userJar
  });
  assert(nestedMacUpload.file.name === nestedMacExpectedName, "nested macOS filename was not normalized");

  const nestedSearch = await request("/api/files?search=nested", { jar: userJar });
  assert(nestedSearch.search.query === "nested", "search query metadata mismatch");
  assert(nestedSearch.files.some((file) => file.id === nestedUpload.file.id), "global search did not find nested file");
  const nestedSearchFile = nestedSearch.files.find((file) => file.id === nestedUpload.file.id);
  assert(nestedSearchFile.path.some((item) => item.id === folder.file.id), "global search result did not include folder path");

  const moveTarget = await request("/api/folders", {
    method: "POST",
    body: { name: "Move Target" },
    jar: userJar
  });
  const moveForm = new FormData();
  moveForm.set("file", new Blob(["move me"], { type: "text/plain" }), "move-me.txt");
  const moveUpload = await request("/api/files/upload", {
    method: "POST",
    body: moveForm,
    jar: userJar
  });
  const movedFile = await request(`/api/files/${moveUpload.file.id}/move`, {
    method: "PATCH",
    body: { parentId: moveTarget.file.id },
    jar: userJar
  });
  assert(movedFile.file.parentId === moveTarget.file.id, "file move parent mismatch");
  const moveTargetList = await request(`/api/files?parentId=${encodeURIComponent(moveTarget.file.id)}`, { jar: userJar });
  assert(moveTargetList.files.some((file) => file.id === moveUpload.file.id), "moved file missing from target folder");
  const movedBack = await request(`/api/files/${moveUpload.file.id}/move`, {
    method: "PATCH",
    body: { parentId: null },
    jar: userJar
  });
  assert(movedBack.file.parentId === null, "file move back to home failed");
  const selfMove = await rawRequest(`/api/files/${moveTarget.file.id}/move`, {
    method: "PATCH",
    body: { parentId: moveTarget.file.id },
    jar: userJar
  });
  assert(selfMove.status === 400, "moving a folder into itself should be rejected");

  const folderDownload = await rawRequest(`/api/files/${folder.file.id}/download`, { jar: userJar });
  assert(folderDownload.status === 200, "folder ZIP download failed");
  assert(String(folderDownload.headers.get("content-type") || "").includes("application/zip"), "folder download is not a ZIP");
  const folderZip = Buffer.from(await folderDownload.arrayBuffer());
  assert(Number(folderDownload.headers.get("content-length")) === folderZip.length, "folder ZIP progress total does not match actual bytes");
  assert(folderZip.subarray(0, 2).toString("utf8") === "PK", "folder ZIP missing PK header");
  assert(folderZip.includes(Buffer.from("nested.txt")), "folder ZIP missing nested file name");
  assert(folderZip.includes(Buffer.from(nestedMacExpectedName, "utf8")), "folder ZIP missing normalized Korean file name");

  const selectedDownload = await rawRequest("/api/files/download", {
    method: "POST",
    body: { ids: [uploaded.file.id, folder.file.id, nestedUpload.file.id] },
    jar: userJar
  });
  assert(selectedDownload.status === 200, "bulk selected ZIP download failed");
  assert(String(selectedDownload.headers.get("content-type") || "").includes("application/zip"), "bulk selected download is not a ZIP");
  const selectedZip = Buffer.from(await selectedDownload.arrayBuffer());
  assert(selectedZip.subarray(0, 2).toString("utf8") === "PK", "bulk selected ZIP missing PK header");
  assert(selectedZip.includes(Buffer.from("hello.txt")), "bulk selected ZIP missing selected file");
  assert(selectedZip.includes(Buffer.from("Documents/nested.txt")), "bulk selected ZIP missing selected folder child");
  const archiveForm = new FormData();
  archiveForm.set('file', new Blob([selectedZip], { type: 'application/zip' }), 'preview-archive.zip');
  const archiveUpload = await request('/api/files/upload', { method: 'POST', body: archiveForm, jar: userJar });
  const archivePreview = await request(`/api/files/${archiveUpload.file.id}/preview`, { jar: userJar });
  assert(archivePreview.kind === 'zip', 'ZIP preview should return an archive listing');
  assert(archivePreview.entries.some(entry => entry.path === 'Documents/nested.txt' && entry.sizeBytes === 20), 'ZIP preview should expose nested paths and sizes');
  const archiveShare = await request(`/api/files/${archiveUpload.file.id}/share`, { method: 'POST', body: { mode: 'hour', password: 'zip-link-password' }, jar: userJar });
  const lockedArchiveShare = await rawRequest(`/api/shares/${archiveShare.share.token}/preview`);
  assert(lockedArchiveShare.status === 423, 'ZIP metadata must not bypass share password');
  await request(`/api/shares/${archiveShare.share.token}/unlock`, { method: 'POST', body: { password: 'zip-link-password' } });
  const sharedArchive = await request(`/api/shares/${archiveShare.share.token}/preview`);
  assert(sharedArchive.kind === 'zip' && sharedArchive.entries.length === archivePreview.entries.length, 'shared ZIP preview should match private preview');
  await request(`/api/files/${archiveUpload.file.id}/password`, { method: 'PUT', body: { password: 'zip-file-password' }, jar: userJar });
  const lockedArchive = await rawRequest(`/api/files/${archiveUpload.file.id}/preview`, { jar: userJar });
  assert(lockedArchive.status === 423, 'ZIP metadata must not bypass file lock');
  await request(`/api/files/${archiveUpload.file.id}/unlock`, { method: 'POST', body: { password: 'zip-file-password' }, jar: userJar });
  const unlockedArchive = await request(`/api/files/${archiveUpload.file.id}/preview`, { jar: userJar });
  assert(unlockedArchive.kind === 'zip', 'unlocked ZIP should support preview');
  const tarSource = path.join(dataDir, 'tar-fixture');
  fs.mkdirSync(tarSource);
  fs.writeFileSync(path.join(tarSource, 'tar-text.txt'), 'tar content');
  const tarBytes = execFileSync('bsdtar', ['-cf', '-', '-C', tarSource, '.']);
  const tarForm = new FormData();
  tarForm.set('file', new Blob([tarBytes], { type: 'application/x-tar' }), 'preview.tar');
  const tarUpload = await request('/api/files/upload', { method: 'POST', body: tarForm, jar: userJar });
  const tarPreview = await request(`/api/files/${tarUpload.file.id}/preview`, { jar: userJar });
  assert(tarPreview.entries.some(entry => entry.path === 'tar-text.txt' && entry.sizeBytes === 11), 'TAR private preview failed');
  const tarShare = await request(`/api/files/${tarUpload.file.id}/share`, { method: 'POST', body: { mode: 'hour' }, jar: userJar });
  const publicTarPreview = await request(`/api/shares/${tarShare.share.token}/preview`);
  assert(publicTarPreview.entries.some(entry => entry.path === 'tar-text.txt'), 'TAR share preview failed');
  await request(`/api/files/${tarUpload.file.id}/password`, { method: 'PUT', body: { password: 'tar-secret' }, jar: userJar });
  const privateLockedTar = await rawRequest(`/api/files/${tarUpload.file.id}/preview`, { jar: userJar });
  assert(privateLockedTar.status === 423, 'TAR listing must respect file passwords');
  const publicLockedTar = await rawRequest(`/api/shares/${tarShare.share.token}/preview`);
  assert(publicLockedTar.status === 423, 'TAR shared listing must respect file passwords');
  assert(countBufferOccurrences(selectedZip, Buffer.from("Documents/nested.txt")) === 2, "bulk selected ZIP duplicated a child selected with its folder");

  const permanentShare = await request(`/api/files/${uploaded.file.id}/share`, {
    method: "POST",
    body: { mode: "permanent" },
    jar: userJar
  });
  assert(permanentShare.share.mode === "permanent", "permanent share mode mismatch");
  assert(permanentShare.share.expiresAt === null, "permanent share should not expire");

  const oldShare = await rawRequest(`/api/shares/${encodeURIComponent(hourShare.share.token)}`);
  assert(oldShare.status === 404, "creating a new share did not revoke the old share");

  await request(`/api/files/${uploaded.file.id}/share`, {
    method: "DELETE",
    jar: userJar
  });
  const revokedShare = await rawRequest(`/api/shares/${encodeURIComponent(permanentShare.share.token)}`);
  assert(revokedShare.status === 404, "revoked permanent share still works");

  const folderShare = await request(`/api/files/${folder.file.id}/share`, {
    method: "POST",
    body: { mode: "permanent" },
    jar: userJar
  });
  assert(folderShare.file.type === "folder", "folder share did not return folder info");

  const publicFolder = await request(`/api/shares/${encodeURIComponent(folderShare.share.token)}`);
  assert(publicFolder.file.id === folder.file.id, "public folder share root mismatch");
  assert(publicFolder.folder.files.some((file) => file.id === nestedUpload.file.id), "public folder share missing nested file");

  const publicFolderDownload = await rawRequest(`/api/shares/${encodeURIComponent(folderShare.share.token)}/download`);
  assert(publicFolderDownload.status === 200, "public folder ZIP download failed");
  const publicFolderZip = Buffer.from(await publicFolderDownload.arrayBuffer());
  assert(publicFolderZip.includes(Buffer.from("nested.txt")), "public folder ZIP missing nested file");
  assert(publicFolderZip.includes(Buffer.from(nestedMacExpectedName, "utf8")), "public folder ZIP missing normalized Korean file");

  const publicNestedDownload = await rawRequest(`/api/shares/${encodeURIComponent(folderShare.share.token)}/items/${nestedUpload.file.id}/download`);
  assert(publicNestedDownload.status === 200, "public nested file download failed");
  assert((await publicNestedDownload.text()) === "inside shared folder", "public nested file content mismatch");

  const users = await request("/api/admin/users", { jar: adminJar });
  assert(users.users.some((user) => user.id === userId), "admin user list missing smoke user");

  const adminCreatedUserId = `admin_created_${Date.now()}`;
  const adminCreated = await request("/api/admin/users", {
    method: "POST",
    body: { id: adminCreatedUserId, password: "created-pw", quotaMb: 150 },
    jar: adminJar
  });
  assert(adminCreated.user.id === adminCreatedUserId, "admin-created user id mismatch");
  assert(adminCreated.user.quotaBytes === 150 * 1024 * 1024, "admin-created user quota mismatch");

  const adminCreatedJar = {};
  const adminCreatedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { id: adminCreatedUserId, password: "created-pw" },
    jar: adminCreatedJar
  });
  assert(adminCreatedLogin.user.id === adminCreatedUserId, "admin-created user could not log in");

  const promotedUser = await request(`/api/admin/users/${encodeURIComponent(adminCreatedUserId)}/role`, {
    method: "PATCH",
    body: { role: "admin" },
    jar: adminJar
  });
  assert(promotedUser.user.role === "admin", "admin could not promote a user");
  const promotedCanAdmin = await request("/api/admin/users", { jar: adminCreatedJar });
  assert(promotedCanAdmin.users.some((user) => user.id === adminCreatedUserId), "promoted user could not access admin API");

  const demotedUser = await request(`/api/admin/users/${encodeURIComponent(adminCreatedUserId)}/role`, {
    method: "PATCH",
    body: { role: "user" },
    jar: adminJar
  });
  assert(demotedUser.user.role === "user", "admin could not demote a user");
  const demotedAdminAccess = await rawRequest("/api/admin/users", { jar: adminCreatedJar });
  assert(demotedAdminAccess.status === 403, "demoted user still had admin API access");

  const adminCreatedForm = new FormData();
  adminCreatedForm.set("file", new Blob(["delete my account"], { type: "text/plain" }), "delete-account.txt");
  const adminCreatedUpload = await request("/api/files/upload", {
    method: "POST",
    body: adminCreatedForm,
    jar: adminCreatedJar
  });
  const adminCreatedDeleted = await request(`/api/admin/users/${encodeURIComponent(adminCreatedUserId)}/permanent`, {
    method: "DELETE",
    jar: adminJar
  });
  assert(adminCreatedDeleted.user.id === adminCreatedUserId, "admin delete user response mismatch");
  assert(adminCreatedDeleted.deletedFiles >= 1, "admin delete user did not report deleted files");

  const deletedUserLogin = await rawRequest("/api/auth/login", {
    method: "POST",
    body: { id: adminCreatedUserId, password: "created-pw" }
  });
  assert(deletedUserLogin.status === 401, "deleted user could still log in");

  const deletedUserFile = await rawRequest(`/api/files/${adminCreatedUpload.file.id}/download`, { jar: adminJar });
  assert(deletedUserFile.status === 404, "deleted user's file still exists");

  const usersAfterDelete = await request("/api/admin/users", { jar: adminJar });
  assert(!usersAfterDelete.users.some((user) => user.id === adminCreatedUserId), "deleted user is still in admin user list");

  const bootstrapDelete = await rawRequest("/api/admin/users/admin/permanent", {
    method: "DELETE",
    jar: adminJar
  });
  assert(bootstrapDelete.status === 400, "bootstrap admin delete should be rejected");
  const bootstrapRoleChange = await rawRequest("/api/admin/users/admin/role", {
    method: "PATCH",
    body: { role: "user" },
    jar: adminJar
  });
  assert(bootstrapRoleChange.status === 400, "bootstrap admin role change should be rejected");

  const adminUserFiles = await request(`/api/files?ownerId=${encodeURIComponent(userId)}`, { jar: adminJar });
  assert(adminUserFiles.owner.id === userId, "admin file list did not target the selected user");
  assert(adminUserFiles.files.some((file) => file.id === uploaded.file.id), "admin could not see user file");
  assert(adminUserFiles.files.every((file) => file.ownerId === userId), "admin user file list leaked another owner");

  const userCannotSwitchOwner = await request("/api/files?ownerId=admin", { jar: userJar });
  assert(userCannotSwitchOwner.owner.id === userId, "non-admin ownerId query changed the target owner");
  assert(userCannotSwitchOwner.files.every((file) => file.ownerId === userId), "non-admin ownerId query leaked admin files");

  const adminUserDownload = await rawRequest(`/api/files/${uploaded.file.id}/download`, { jar: adminJar });
  assert(adminUserDownload.status === 200, "admin could not download user file");
  assert((await adminUserDownload.text()) === "hello ddato drive", "admin user file download content mismatch");

  const adminFolder = await request("/api/folders", {
    method: "POST",
    body: { ownerId: userId, name: "Admin Managed" },
    jar: adminJar
  });
  assert(adminFolder.file.ownerId === userId, "admin-created folder was not assigned to target user");

  const adminUploadForm = new FormData();
  adminUploadForm.set("ownerId", userId);
  adminUploadForm.set("parentId", adminFolder.file.id);
  adminUploadForm.set("file", new Blob(["admin managed upload"], { type: "text/plain" }), "admin-managed.txt");
  const adminUpload = await request("/api/files/upload", {
    method: "POST",
    body: adminUploadForm,
    jar: adminJar
  });
  assert(adminUpload.file.ownerId === userId, "admin upload was not assigned to target user");
  assert(adminUpload.file.parentId === adminFolder.file.id, "admin upload parent mismatch");

  const adminUploadPreview = await rawRequest(`/api/files/${adminUpload.file.id}/preview`, { jar: adminJar });
  assert(adminUploadPreview.status === 200, "admin could not preview user file");
  assert((await adminUploadPreview.text()) === "admin managed upload", "admin preview content mismatch");

  const adminRenamed = await request(`/api/files/${adminUpload.file.id}/rename`, {
    method: "PATCH",
    body: { name: "admin-renamed.txt" },
    jar: adminJar
  });
  assert(adminRenamed.file.name === "admin-renamed.txt", "admin could not rename user file");

  const adminColoredFolder = await request(`/api/folders/${adminFolder.file.id}/color`, {
    method: "PATCH",
    body: { color: "blue" },
    jar: adminJar
  });
  assert(adminColoredFolder.file.folderColor === "blue", "admin could not change user folder color");

  const adminShare = await request(`/api/files/${adminRenamed.file.id}/share`, {
    method: "POST",
    body: { mode: "hour" },
    jar: adminJar
  });
  assert(adminShare.share.mode === "hour", "admin could not create user file share");
  await request(`/api/files/${adminRenamed.file.id}/share`, {
    method: "DELETE",
    jar: adminJar
  });

  await request(`/api/files/${adminRenamed.file.id}`, {
    method: "DELETE",
    jar: adminJar
  });
  const adminUserTrash = await request(`/api/trash?ownerId=${encodeURIComponent(userId)}`, { jar: adminJar });
  assert(adminUserTrash.files.some((file) => file.id === adminRenamed.file.id), "admin could not see user trash");

  await request(`/api/trash/${adminRenamed.file.id}/restore`, {
    method: "POST",
    jar: adminJar
  });
  const adminFolderList = await request(`/api/files?ownerId=${encodeURIComponent(userId)}&parentId=${encodeURIComponent(adminFolder.file.id)}`, { jar: adminJar });
  assert(adminFolderList.files.some((file) => file.id === adminRenamed.file.id), "admin could not restore user file");

  const adminPurgeForm = new FormData();
  adminPurgeForm.set("ownerId", userId);
  adminPurgeForm.set("file", new Blob(["purge by admin"], { type: "text/plain" }), "admin-purge.txt");
  const adminPurgeUpload = await request("/api/files/upload", {
    method: "POST",
    body: adminPurgeForm,
    jar: adminJar
  });
  await request(`/api/files/${adminPurgeUpload.file.id}`, {
    method: "DELETE",
    jar: adminJar
  });
  await request(`/api/trash/${adminPurgeUpload.file.id}`, {
    method: "DELETE",
    jar: adminJar
  });
  const adminPurgedTrash = await request(`/api/trash?ownerId=${encodeURIComponent(userId)}`, { jar: adminJar });
  assert(!adminPurgedTrash.files.some((file) => file.id === adminPurgeUpload.file.id), "admin could not purge user file");

  const disabledUserId = `disabled_${Date.now()}`;
  const disabledJar = {};
  await request("/api/admin/users", {
    method: "POST",
    body: { id: disabledUserId, password: "pw" },
    jar: adminJar
  });
  await request("/api/auth/login", {
    method: "POST",
    body: { id: disabledUserId, password: "pw" },
    jar: disabledJar
  });
  const disabledForm = new FormData();
  disabledForm.set("file", new Blob(["disabled user file"], { type: "text/plain" }), "disabled.txt");
  const disabledUpload = await request("/api/files/upload", {
    method: "POST",
    body: disabledForm,
    jar: disabledJar
  });
  await request(`/api/admin/users/${encodeURIComponent(disabledUserId)}`, {
    method: "DELETE",
    jar: adminJar
  });
  const disabledLogin = await rawRequest("/api/auth/login", {
    method: "POST",
    body: { id: disabledUserId, password: "pw" }
  });
  assert(disabledLogin.status === 403, "disabled user should not be able to log in");
  const disabledAdminList = await request(`/api/files?ownerId=${encodeURIComponent(disabledUserId)}`, { jar: adminJar });
  assert(disabledAdminList.files.some((file) => file.id === disabledUpload.file.id), "admin could not list disabled user's files");
  await request(`/api/files/${disabledUpload.file.id}`, {
    method: "DELETE",
    jar: adminJar
  });
  const disabledAdminTrash = await request(`/api/trash?ownerId=${encodeURIComponent(disabledUserId)}`, { jar: adminJar });
  assert(disabledAdminTrash.files.some((file) => file.id === disabledUpload.file.id), "admin could not manage disabled user's trash");
  const enabledUser = await request(`/api/admin/users/${encodeURIComponent(disabledUserId)}/enable`, {
    method: "POST",
    jar: adminJar
  });
  assert(enabledUser.user.disabledAt === null, "admin could not re-enable disabled user");
  const enabledLogin = await request("/api/auth/login", {
    method: "POST",
    body: { id: disabledUserId, password: "pw" },
    jar: {}
  });
  assert(enabledLogin.user.id === disabledUserId, "re-enabled user could not log in");

  await request(`/api/admin/users/${encodeURIComponent(userId)}/quota`, {
    method: "PATCH",
    body: { quotaMb: 200 },
    jar: adminJar
  });

  const systemStatus = await request("/api/admin/system", { jar: adminJar });
  assert(systemStatus.system.disk && systemStatus.system.project, "admin system status shape mismatch");
  assert(systemStatus.system.project.totalBytes === 1024 * 1024 * 1024 * 1024, "project disk quota is not 1TB");
  const auditLogs = await request("/api/admin/audit?limit=20", { jar: adminJar });
  assert(Array.isArray(auditLogs.logs), "admin audit logs response mismatch");

  const trashForm = new FormData();
  trashForm.set("file", new Blob(["restore me"], { type: "text/plain" }), "trash-smoke.txt");
  const trashUpload = await request("/api/files/upload", {
    method: "POST",
    body: trashForm,
    jar: userJar
  });
  await request(`/api/files/${trashUpload.file.id}`, {
    method: "DELETE",
    jar: userJar
  });
  const trashList = await request("/api/trash", { jar: userJar });
  assert(trashList.files.some((file) => file.id === trashUpload.file.id), "trash list missing deleted file");
  await request(`/api/trash/${trashUpload.file.id}/restore`, {
    method: "POST",
    jar: userJar
  });
  const restoredList = await request("/api/files", { jar: userJar });
  assert(restoredList.files.some((file) => file.id === trashUpload.file.id), "restored file missing from active list");
  await request(`/api/files/${trashUpload.file.id}`, {
    method: "DELETE",
    jar: userJar
  });
  await request(`/api/trash/${trashUpload.file.id}`, {
    method: "DELETE",
    jar: userJar
  });
  const purgedTrashList = await request("/api/trash", { jar: userJar });
  assert(!purgedTrashList.files.some((file) => file.id === trashUpload.file.id), "purged file is still in trash");

  const quotaUserId = `quota_${Date.now()}`;
  await request("/api/admin/users", {
    method: "POST",
    body: { id: quotaUserId, password: "pw", quotaMb: 1 },
    jar: adminJar
  });
  const quotaJar = {};
  await request("/api/auth/login", {
    method: "POST",
    body: { id: quotaUserId, password: "pw" },
    jar: quotaJar
  });
  const quotaForm = new FormData();
  quotaForm.set("file", new Blob([Buffer.alloc(700 * 1024, 65)], { type: "text/plain" }), "quota-a.txt");
  const quotaUpload = await request("/api/files/upload", {
    method: "POST",
    body: quotaForm,
    jar: quotaJar
  });
  await request(`/api/files/${quotaUpload.file.id}`, {
    method: "DELETE",
    jar: quotaJar
  });
  const quotaAfterTrash = await request("/api/auth/me", { jar: quotaJar });
  assert(quotaAfterTrash.user.usageBytes >= 700 * 1024, "trash bytes should still count against quota");
  const quotaBypassForm = new FormData();
  quotaBypassForm.set("file", new Blob([Buffer.alloc(700 * 1024, 66)], { type: "text/plain" }), "quota-b.txt");
  const quotaBypassAttempt = await rawRequest("/api/files/upload", {
    method: "POST",
    body: quotaBypassForm,
    jar: quotaJar
  });
  assert(quotaBypassAttempt.status === 413, "trash should not allow quota bypass uploads");
  const quotaBypassBody = await quotaBypassAttempt.json();
  assert(quotaBypassBody.error === "저장 공간이 부족합니다.", "quota error should be user-friendly");
  assert(quotaBypassBody.details?.code === "user_quota_exceeded", "quota error should include a stable code");
  assert(Number.isFinite(quotaBypassBody.details?.remainingBytes), "quota error should include remaining bytes");

  const pendingQuotaUserId = `pending_${Date.now()}`;
  await request("/api/admin/users", {
    method: "POST",
    body: { id: pendingQuotaUserId, password: "pw", quotaMb: 1 },
    jar: adminJar
  });
  const pendingQuotaJar = {};
  await request("/api/auth/login", {
    method: "POST",
    body: { id: pendingQuotaUserId, password: "pw" },
    jar: pendingQuotaJar
  });
  const pendingSession = await request("/api/files/upload-sessions", {
    method: "POST",
    body: { name: "pending-a.bin", sizeBytes: 800 * 1024, mimeType: "application/octet-stream" },
    jar: pendingQuotaJar
  });
  const pendingBlockedForm = new FormData();
  pendingBlockedForm.set("file", new Blob([Buffer.alloc(300 * 1024, 67)], { type: "application/octet-stream" }), "pending-b.bin");
  const pendingBlocked = await rawRequest("/api/files/upload", {
    method: "POST",
    body: pendingBlockedForm,
    jar: pendingQuotaJar
  });
  assert(pendingBlocked.status === 413, "pending resumable uploads should reserve quota");
  await request(`/api/files/upload-sessions/${encodeURIComponent(pendingSession.session.id)}`, {
    method: "DELETE",
    jar: pendingQuotaJar
  });

  const lockedUserId = `locked_${Date.now()}`;
  await request("/api/admin/users", {
    method: "POST",
    body: { id: lockedUserId, password: "correct" },
    jar: adminJar
  });

  for (let index = 0; index < 5; index += 1) {
    const failedLogin = await rawRequest("/api/auth/login", {
      method: "POST",
      body: { id: lockedUserId, password: "wrong" }
    });
    const body = await failedLogin.json();
    if (index < 4) {
      assert(failedLogin.status === 401, "failed login should return 401 before lock threshold");
    } else {
      assert(failedLogin.status === 423, "fifth failed login should lock the account");
      assert(body.details.lockedUntil > Date.now(), "locked account response missing lockedUntil");
    }
  }

  const blockedCorrectLogin = await rawRequest("/api/auth/login", {
    method: "POST",
    body: { id: lockedUserId, password: "correct" }
  });
  assert(blockedCorrectLogin.status === 423, "locked account accepted a correct password");

  const unlockedUser = await request(`/api/admin/users/${encodeURIComponent(lockedUserId)}/unlock`, {
    method: "POST",
    jar: adminJar
  });
  assert(unlockedUser.user.loginFailedCount === 0, "admin unlock did not reset failed login count");
  assert(unlockedUser.user.loginLockedUntil === null, "admin unlock did not clear login lock");

  const unlockedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { id: lockedUserId, password: "correct" },
    jar: {}
  });
  assert(unlockedLogin.user.id === lockedUserId, "unlocked user could not log in");

  console.log("Smoke test passed.");
} finally {
  if (server) {
    server.kill("SIGTERM");
  }
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for health endpoint.");
}

async function request(route, options = {}) {
  const response = await rawRequest(route, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${route}, got: ${text}`);
  }
  if (!response.ok || json.ok === false) {
    throw new Error(`Request failed ${response.status} ${route}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function rawRequest(route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.jar && Object.keys(options.jar).length) {
    headers.set("cookie", Object.entries(options.jar).map(([key, value]) => `${key}=${value}`).join("; "));
  }

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers,
    body
  });

  if (options.jar) {
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const first = setCookie.split(";")[0];
      const separatorIndex = first.indexOf("=");
      if (separatorIndex > 0) {
        options.jar[first.slice(0, separatorIndex)] = first.slice(separatorIndex + 1);
      }
    }
  }

  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function encodeRfc5987FileName(value) {
  return `filename*=UTF-8''${encodeURIComponent(value).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  })}`;
}

function countBufferOccurrences(buffer, needle) {
  let count = 0;
  let index = 0;
  while (index <= buffer.length - needle.length) {
    const next = buffer.indexOf(needle, index);
    if (next < 0) break;
    count += 1;
    index = next + needle.length;
  }
  return count;
}
