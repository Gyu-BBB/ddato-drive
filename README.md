# DDATO Drive Backend

DDATO Drive is a self-hosted drive API server. The frontend can be added later.

## Run

```bash
npm install
npm run build
npm start
```

Default URL:

```text
http://localhost:4000
```

For frontend development with hot reload:

```bash
npm run dev:api
npm run dev:web
```

The Vite dev server runs on:

```text
http://localhost:5174
```

`npm run dev:web` proxies `/api` requests to `http://127.0.0.1:4000`.

Default storage root:

```text
/Users/gyubeomlee/NASDrive
```

The server creates this admin account on startup if it does not exist:

```text
id: admin
password: 518520
quota: unlimited
```

Use the hidden admin login page for the bootstrap admin account:

```text
https://ddato.site/admin-login
```

The public sign-in screen uses Google login only. New Google users receive a
1GB default quota.

## Google Login

Google login is enabled only when both values are present in `.env`:

```env
DDATO_DRIVE_PUBLIC_URL=https://ddato.site
DDATO_DRIVE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
DDATO_DRIVE_GOOGLE_CLIENT_SECRET=your-client-secret
```

Use this redirect URI in Google Cloud:

```text
https://ddato.site/api/auth/google/callback
```

Local test redirects can also be registered if needed:

```text
http://localhost:4000/api/auth/google/callback
http://127.0.0.1:4000/api/auth/google/callback
```

## Main API

```text
GET  /api/health
GET  /api/auth/google
GET  /api/auth/google/callback
POST /api/auth/logout
GET  /api/auth/me

GET    /api/files?parentId=&ownerId=
GET    /api/files/:id/share
POST   /api/files/:id/share
DELETE /api/files/:id/share
POST   /api/files/upload
POST   /api/folders
PATCH  /api/files/:id/rename
DELETE /api/files/:id
GET    /api/files/:id/download
GET    /api/files/:id/preview
GET    /api/files/:id/preview-status
GET    /api/shares/:token
GET    /api/shares/:token/download
GET    /api/shares/:token/preview
GET    /api/shares/:token/preview-status

GET    /api/admin/users
PATCH  /api/admin/users/:id/quota
GET    /api/admin/users/:id/files?parentId=
DELETE /api/admin/users/:id
GET    /api/admin/storage
GET    /api/admin/system
GET    /api/admin/audit
```

Normal users can only access their own files. Admin users can access every
user's files and adjust quotas.

Document previews are generated asynchronously when PDF conversion is needed.
The admin page shows the 1TB project disk allocation, storage breakdown,
preview cache size, and recent audit logs.

## Caddy

If this server is running on port 4000, point `ddato.site` at it:

```caddyfile
ddato.site {
  reverse_proxy localhost:4000
}
```

## Smoke test

```bash
npm run build
npm run smoke
```

## Open Design frontend planning

This repo includes Open Design-compatible resources for the future frontend:

```text
DESIGN.md
design-systems/ddato-drive/
skills/ddato-drive-frontend/
docs/open-design.md
```

Use the `DDATO Drive` design system and `ddato-drive-frontend` skill when generating the React frontend. The skill points agents to the backend API contract and requires feature-split frontend modules instead of one large root component.
