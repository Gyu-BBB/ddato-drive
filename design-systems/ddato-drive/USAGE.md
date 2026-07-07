# DDATO Drive Design System Usage

Use this design system when generating or editing the DDATO Drive frontend.

## Required app surfaces

- Login
- Signup
- Drive workspace
- File preview
- Upload progress
- Admin users and quota management
- Admin user file browser

## Implementation notes

- Prefer React feature modules over a single large `App.jsx`.
- Keep API calls in feature-local clients.
- Use list view as the default file browser.
- Use icon buttons for file actions where a standard icon exists.
- Do not create a marketing landing page as the first screen.
- Do not invent backend endpoints that are missing from `skills/ddato-drive-frontend/assets/api-contract.json`.
