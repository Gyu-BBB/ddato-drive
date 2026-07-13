# DDATO Drive

DDATO Drive is a self-hosted web drive that turns your own computer or server into a private NAS-like file service. It includes a React web app, an Express API server, SQLite metadata storage, local-disk file storage, admin controls, public share links, previews, resumable uploads, and mobile/desktop responsive UI.

This project was built for a personal domain setup such as `ddato.site`, but it can run locally or behind any reverse proxy.

## Features

- Google sign-in for normal users
- Separate bootstrap admin login at `/admin-login`
- Admin user management, role changes, quota changes, login unlocks, and user deletion
- Configurable default user quota, with a project-wide disk quota
- File and folder upload, including drag-and-drop folder upload
- Resumable upload sessions with pause, cancel, retry, and reload recovery
- Finder-style drive views: icon, list, column, and gallery
- File search across folders with path information
- Sorting by name, size, extension, created date, updated date, and type
- Folder colors and file/folder move, duplicate, rename, trash, restore, and purge
- Multi-select actions and context menus
- Download files and stream folder ZIP downloads
- Public share links with 1-hour or permanent expiration modes
- Optional share password
- File and note access passwords for preview, download, share, delete, move, rename, and duplicate governance
- Admin reset for forgotten file/note access passwords
- Image/video viewer and memo page
- Document, text, image, audio, video, PDF, spreadsheet, and archive preview support where possible
- Async document PDF preview jobs with text fallback
- Admin audit logs and storage/system status dashboard
- Cross-platform filename normalization for macOS upload and Windows download compatibility

## Tech Stack

- Runtime: Node.js 23+
- Backend: Express 5
- Frontend: React 19, Vite 8
- Database: SQLite through `node:sqlite`
- File storage: local filesystem
- Auth: cookie sessions, Google OAuth, bootstrap admin password login
- UI icons: Lucide React

## Project Structure

```text
src/
  client/             React app, pages, shared UI, API clients
  core/               config, HTTP helpers, rate limits, filename policy
  database/           SQLite connection and schema bootstrap
  features/
    admin/            admin APIs and service layer
    audit/            audit logging
    auth/             sessions, Google OAuth, admin login
    files/            file routes, storage, upload, preview, ZIP
    health/           health endpoint
    notes/            memo APIs and password governance
    protection/       file/note/share password unlock logic
    settings/         app settings and default quota
    shares/           public share links
    system/           storage and disk status
    users/            user repository and serialization
```

The backend follows a router -> service -> repository/storage/policy shape so large behavior does not live in one file.

## Requirements

- Node.js 23 or newer
- npm
- A writable local storage directory
- Optional: Caddy, Nginx, or another reverse proxy for domain/HTTPS usage
- Optional: Google Cloud OAuth client for Google login

## Quick Start

```bash
git clone https://github.com/Gyu-BBB/ddato-drive.git
cd ddato-drive
npm install
cp .env.example .env
npm run build
npm start
```

Default local URL:

```text
http://localhost:4000
```

Default storage root from `.env.example`:

```text
/Users/gyubeomlee/NASDrive
```

Change `DDATO_DRIVE_DATA_DIR` before production use if you want files stored somewhere else.

## Environment Variables

Create `.env` from `.env.example`.

```env
DDATO_DRIVE_HOST=0.0.0.0
DDATO_DRIVE_PORT=4000
DDATO_DRIVE_DATA_DIR=/Users/gyubeomlee/NASDrive

DDATO_DRIVE_ADMIN_ID=admin
DDATO_DRIVE_ADMIN_PASSWORD=518520
DDATO_DRIVE_DEFAULT_QUOTA_MB=1024
DDATO_DRIVE_PROJECT_QUOTA_GB=1024

DDATO_DRIVE_TRUST_PROXY=1
DDATO_DRIVE_PUBLIC_URL=https://ddato.site
DDATO_DRIVE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
DDATO_DRIVE_GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Important defaults:

- New users receive `DDATO_DRIVE_DEFAULT_QUOTA_MB`, default `1024 MB`.
- The whole project is capped by `DDATO_DRIVE_PROJECT_QUOTA_GB`, default `1024 GB`.
- The bootstrap admin has unlimited quota.
- `.env` is ignored by git and must not be committed.

## Admin Login

The bootstrap admin is created automatically when the server starts.

```text
URL: /admin-login
ID: admin
Password: 518520
```

For a public server, set a stronger `DDATO_DRIVE_ADMIN_PASSWORD` before the first startup. If the bootstrap admin already exists, log in as admin and change the password from the profile menu.

Normal users should sign in with Google from the public login page.

## Google OAuth Setup

Google login is enabled only when both client values are present:

```env
DDATO_DRIVE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
DDATO_DRIVE_GOOGLE_CLIENT_SECRET=your-google-client-secret
```

For a domain setup, configure Google Cloud OAuth with:

```text
Authorized JavaScript origin:
https://ddato.site

Authorized redirect URI:
https://ddato.site/api/auth/google/callback
```

For local testing, you can also register:

```text
http://localhost:4000
http://localhost:4000/api/auth/google/callback
http://127.0.0.1:4000
http://127.0.0.1:4000/api/auth/google/callback
```

## Development

Run API and Vite frontend separately:

```bash
npm run dev:api
npm run dev:web
```

Vite dev URL:

```text
http://localhost:5174
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:4000`.

## Production Build

```bash
npm run build
npm start
```

The Express server serves the built React app from `dist/` and the API from `/api`.

## Reverse Proxy Example

Caddy example for `ddato.site`:

```caddyfile
{
  http_port 8080
  https_port 8443
}

ddato.site {
  reverse_proxy localhost:4000
}

www.ddato.site {
  redir https://ddato.site{uri} permanent
}
```

When running behind a reverse proxy, set:

```env
DDATO_DRIVE_TRUST_PROXY=1
DDATO_DRIVE_PUBLIC_URL=https://ddato.site
```

## Storage Model

DDATO Drive stores metadata in SQLite and file bytes on disk.

```text
DDATO_DRIVE_DATA_DIR/
  app-data/
    drive.sqlite
    previews/
  storage/
  temp/
  trash/
```

Files in trash still count against quota until they are permanently deleted.

## Security Notes

This is a self-hosted application. Before exposing it publicly:

- Change the default admin password before the first startup, or update it from the admin profile menu after logging in.
- Keep `.env` private.
- Use HTTPS through a reverse proxy.
- Set `DDATO_DRIVE_PUBLIC_URL` to the public origin.
- Keep `DDATO_DRIVE_TRUST_PROXY=1` only when you control the proxy.
- Review public share settings before sharing folders.
- Understand that permanent share links remain valid until revoked.
- Use file/note/share passwords for sensitive items.
- Back up `DDATO_DRIVE_DATA_DIR`, especially `drive.sqlite` and `storage/`.

## Validation

Run the production build and smoke test:

```bash
npm run build
npm run smoke
```

The smoke test starts a temporary server, uses an isolated temporary data directory, and checks auth, admin controls, uploads, previews, sharing, quotas, trash, passwords, ZIP download, and cross-platform filename behavior.

## API Overview

Health:

```text
GET /api/health
```

Auth:

```text
GET  /api/auth/me
GET  /api/auth/google/status
GET  /api/auth/google
GET  /api/auth/google/callback
POST /api/auth/login
POST /api/auth/logout
PATCH /api/auth/profile
```

Files:

```text
GET    /api/files
GET    /api/files/media
GET    /api/files/:id
POST   /api/files/upload
POST   /api/files/upload-sessions
POST   /api/files/upload-sessions/:sessionId/chunk
POST   /api/files/upload-sessions/:sessionId/complete
DELETE /api/files/upload-sessions/:sessionId
POST   /api/folders
PATCH  /api/files/:id/rename
PATCH  /api/files/:id/move
PATCH  /api/folders/:id/color
POST   /api/files/:id/duplicate
DELETE /api/files/:id
GET    /api/files/:id/download
GET    /api/files/:id/preview
GET    /api/files/:id/preview-status
```

Trash:

```text
GET    /api/trash
POST   /api/trash/:id/restore
DELETE /api/trash/:id
```

Access passwords:

```text
PUT    /api/files/:id/password
DELETE /api/files/:id/password
POST   /api/files/:id/unlock
PUT    /api/notes/:id/password
DELETE /api/notes/:id/password
POST   /api/notes/:id/unlock
```

Shares:

```text
GET    /api/files/:id/share
POST   /api/files/:id/share
DELETE /api/files/:id/share
GET    /api/shares/:token
POST   /api/shares/:token/unlock
GET    /api/shares/:token/download
GET    /api/shares/:token/items/:id/download
GET    /api/shares/:token/preview
GET    /api/shares/:token/preview-status
```

Notes:

```text
GET    /api/notes
POST   /api/notes
GET    /api/notes/:id
PATCH  /api/notes/:id
DELETE /api/notes/:id
```

Admin:

```text
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:id/quota
PATCH  /api/admin/users/:id/role
GET    /api/admin/users/:id/files
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/enable
DELETE /api/admin/users/:id/permanent
POST   /api/admin/users/:id/unlock
DELETE /api/admin/files/:id/password
DELETE /api/admin/notes/:id/password
GET    /api/admin/storage
GET    /api/admin/system
PATCH  /api/admin/settings/default-quota
GET    /api/admin/audit
```

## Design Resources

The repository includes local design/planning resources:

```text
DESIGN.md
design-systems/ddato-drive/
skills/ddato-drive-frontend/
docs/open-design.md
```

These describe the DDATO Drive visual system, Open Design references, API contract, and frontend architecture expectations.

## License

No license has been declared yet. Add a license before others reuse or redistribute the project.
