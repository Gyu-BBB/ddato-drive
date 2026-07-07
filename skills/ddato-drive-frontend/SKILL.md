---
name: ddato-drive-frontend
description: |
  Build or update the React frontend for DDATO Drive, a self-hosted web drive/NAS app.
triggers:
  - "ddato drive frontend"
  - "drive frontend"
  - "NAS frontend"
  - "file manager UI"
od:
  mode: prototype
  platform: desktop
  scenario: app
  preview:
    type: jsx
    entry: src/main.jsx
  design_system:
    requires: true
    sections: [color, typography, layout, components, responsive]
  craft:
    requires: [typography, color, anti-ai-slop]
  inputs:
    - name: app_name
      type: string
      default: "DDATO Drive"
      required: true
    - name: include_admin
      type: boolean
      default: true
    - name: default_view
      type: enum
      values: [list, grid]
      default: list
  outputs:
    primary: src/main.jsx
    secondary:
      - src/features/auth
      - src/features/files
      - src/features/admin
      - src/shared
  capabilities_required:
    - file_write
---

# DDATO Drive Frontend Skill

Build the actual DDATO Drive frontend against the existing backend API. Do not build a landing page. The first authenticated screen is the drive workspace.

## Required reading

1. Read the active `DESIGN.md`.
2. Read `skills/ddato-drive-frontend/assets/api-contract.json`.
3. Read `skills/ddato-drive-frontend/assets/frontend-architecture.md`.
4. Inspect the existing project files before editing.

## Required screens

1. Login screen.
2. Signup screen.
3. Drive workspace with toolbar, breadcrumbs, file list, quota display, upload, folder creation, rename, delete, download, preview.
4. Preview pane or full-screen preview route for images, PDF, text, video, and audio.
5. Admin area with user list, quota editor, storage summary, and selected user's file browser.

## Architecture rules

- Keep modules split by feature.
- Do not put all UI state and API calls in one root component.
- Use feature folders:
  - `src/features/auth`
  - `src/features/files`
  - `src/features/admin`
  - `src/shared/components`
  - `src/shared/api`
  - `src/app`
- Keep `src/App.jsx` or equivalent as composition only.
- Use API client helpers rather than ad hoc fetch calls scattered through components.
- Keep visual tokens in CSS variables.

## Backend contract

The backend uses cookie sessions. Every request should use `credentials: "include"`.

The frontend must not depend on endpoints not listed in `api-contract.json`.

## UX priorities

1. Fast upload and download workflows.
2. Clear quota feedback.
3. Clear file ownership context for admins.
4. Mobile-friendly file actions.
5. Plain, reliable preview behavior.

## Completion checklist

- App builds successfully.
- Login and signup can reach the backend.
- Authenticated file list can render.
- Upload uses `multipart/form-data`.
- Preview/download URLs preserve cookies.
- Admin screens are hidden from non-admin users.
- Responsive layout has no text overlap at phone width.
