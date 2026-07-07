# Open Design Setup for DDATO Drive

DDATO Drive includes Open Design-compatible project files so the frontend can be generated against a stable design system and backend API contract.

## What was added

```text
DESIGN.md
design-systems/ddato-drive/
skills/ddato-drive-frontend/
```

`DESIGN.md` is the project-level design contract. `design-systems/ddato-drive/` is the same contract packaged in Open Design's design-system project shape. `skills/ddato-drive-frontend/` is the generation workflow for the React frontend.

## How to use with Open Design

1. Open this folder as the project:

```bash
cd /Users/gyubeomlee/Documents/ddato_drive
```

2. In Open Design, choose the `DDATO Drive` design system if it appears in the picker. If using a local agent directly, tell it to read `DESIGN.md` and `skills/ddato-drive-frontend/SKILL.md`.

3. Use the frontend skill prompt:

```text
Use the ddato-drive-frontend skill and DDATO Drive design system to build the React frontend for this backend.
```

## Important constraints

- Build the actual drive workspace, not a landing page.
- Use the API contract at `skills/ddato-drive-frontend/assets/api-contract.json`.
- Keep frontend code split by feature.
- Do not add unsupported API calls unless the backend is updated too.

## Backend while designing

Run the API server:

```bash
npm start
```

The frontend should call the API on the same origin when served by the same Express app later, or use a dev proxy during Vite development.
