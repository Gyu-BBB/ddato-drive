# DDATO Drive
> Category: Product System
> A quiet, file-first design system for a self-hosted personal drive and NAS web app.

## Visual Theme & Atmosphere
DDATO Drive should feel like a dependable private file cabinet, not a marketing site. The interface is calm, compact, and operational. Screens prioritize scanning, selecting, uploading, previewing, quota awareness, and admin review. Use restraint: no decorative hero art, no oversized empty states, no ornamental gradients.

The first screen after login is the actual drive workspace. Public pages should be limited to authentication and necessary account creation.

## Color Palette & Roles
- **Background:** `#F7F8FA` for the app shell.
- **Surface:** `#FFFFFF` for toolbar bands, file rows, dialogs, and preview panes.
- **Surface raised:** `#F2F5F8` for selected rows and secondary panels.
- **Foreground:** `#17202A` for primary text.
- **Muted:** `#64717F` for metadata, breadcrumbs, and helper labels.
- **Border:** `#DCE3EA` for row dividers, inputs, and panel boundaries.
- **Primary:** `#0E7C66` for primary actions, upload progress, active navigation.
- **Primary hover:** `#0A6755`.
- **Info:** `#2563EB` for links and preview affordances.
- **Warn:** `#B7791F` for quota warnings.
- **Danger:** `#C2413A` for destructive actions.
- **Success:** `#248A55`.

Use the primary color sparingly. Most surfaces are neutral. File-type color is allowed only as small icon accents.

## Typography Rules
- **UI font:** `Inter`, `Pretendard`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif.
- **Mono font:** `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, monospace.
- **Base size:** 14px for dense tool surfaces.
- **Small metadata:** 12px.
- **Body:** 14px or 15px.
- **Panel headings:** 16px or 18px.
- **Page title:** 20px or 24px.
- **Line height:** 1.4 for dense UI, 1.55 for readable documents.
- **Letter spacing:** 0.

Avoid viewport-scaled text. Avoid display typography except in login/signup screens.

## Component Stylings
- **App shell:** left navigation rail, top toolbar, main content region, optional right preview inspector.
- **Toolbar:** 44-56px height, solid surface, bottom border, compact icon buttons with tooltips.
- **Buttons:** 8px radius max. Primary buttons use `--color-primary`; secondary buttons use border and white background.
- **Icon buttons:** square 36px or 40px; use recognizable upload, folder, download, trash, search, grid/list, settings icons.
- **Inputs:** 8px radius, 1px border, 36-40px height. Focus border uses primary.
- **File rows:** 44-52px height desktop, 56-64px mobile. Filename column owns flexible width. Metadata columns align right.
- **Cards:** only for repeated storage/user summaries or modal content. Do not put page sections inside cards.
- **Dialogs:** centered or sheet-style on mobile, with clear destructive confirmation copy.
- **Progress:** thin horizontal bars for quota and upload. Use text only for exact numbers.
- **Preview pane:** plain framed region, no decorative chrome.

## Layout Principles
- Desktop layout is a functional workspace: navigation rail, file table/grid, preview/admin side panel.
- Mobile layout uses bottom or top compact navigation, with file actions in a sheet.
- Prefer list view as the default for file management; grid view is optional for images.
- Keep upload, new folder, search, sort, and view mode in the first toolbar.
- Breadcrumbs must remain visible in nested folders.
- Quota should be visible in the sidebar or account menu, not hidden in settings.
- Admin pages should use tables and detail panels, not marketing cards.

## Depth & Elevation
Use borders before shadows. Shadows are reserved for menus, popovers, modals, and floating upload progress.

Elevation scale:
- 0: app shell, file list, preview pane.
- 1: dropdowns, menus, selected floating toolbar.
- 2: modal dialogs.

No glassmorphism, neumorphism, glow effects, bokeh, or decorative blobs.

## Do's and Don'ts
- Do make the drive workspace the primary experience.
- Do keep common actions one click away.
- Do show file size, modified date, type, owner, and quota clearly.
- Do design empty states that invite upload or folder creation.
- Do preserve dense scanning on desktop.
- Do make mobile upload and preview comfortable.
- Do make admin access visibly different from normal user access.
- Do not create a landing page unless explicitly requested.
- Do not use large hero cards for the app shell.
- Do not hide destructive actions without confirmation.
- Do not use brand-like gradients or a one-note blue/purple palette.
- Do not invent file operations that the backend does not support.

## Responsive Behavior
- **Desktop >= 1200px:** sidebar + toolbar + file list + optional preview inspector.
- **Laptop 900-1199px:** sidebar may collapse; preview becomes drawer.
- **Tablet 640-899px:** toolbar wraps into segmented controls; metadata columns reduce.
- **Phone < 640px:** single-column file list, sticky action bar, bottom sheet menus, preview as full-screen route/sheet.

Maintain touch targets of at least 40px on mobile.

## Agent Prompt Guide
When generating the frontend, build the actual app screens:
1. Login and signup.
2. Drive workspace.
3. File upload and progress.
4. Preview panel.
5. Admin user/quota/file browser.

Use the API contract in `skills/ddato-drive-frontend/assets/api-contract.json`. Do not add unsupported backend features unless the backend is extended in the same change. Keep frontend modules split by feature: `auth`, `files`, `admin`, `shared`, and `app`.
