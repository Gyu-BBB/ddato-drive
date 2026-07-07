# DDATO Drive Frontend Architecture

The frontend should be feature-split from the first commit.

```text
src/
  app/
    App.jsx
    app.css
    routes.jsx
  shared/
    api/
      apiClient.js
      apiError.js
    components/
      Button.jsx
      IconButton.jsx
      Dialog.jsx
      EmptyState.jsx
      ProgressBar.jsx
      Tooltip.jsx
    lib/
      formatBytes.js
      dates.js
  features/
    auth/
      AuthProvider.jsx
      LoginPage.jsx
      SignupPage.jsx
      authApi.js
    files/
      DrivePage.jsx
      FileToolbar.jsx
      FileList.jsx
      FileRow.jsx
      Breadcrumbs.jsx
      PreviewPane.jsx
      UploadQueue.jsx
      filesApi.js
    admin/
      AdminPage.jsx
      UsersTable.jsx
      QuotaEditor.jsx
      AdminFileBrowser.jsx
      adminApi.js
```

## State boundaries

- `AuthProvider` owns current user and session refresh.
- `DrivePage` owns current folder, selected file, view mode, and upload queue.
- `AdminPage` owns selected user and quota edit state.
- Shared components must not call the API directly.

## API client rules

- Always call fetch with `credentials: "include"`.
- Convert non-2xx JSON errors into thrown `ApiError`.
- Use `FormData` for uploads.
- Use object URLs for blob previews and revoke them on cleanup.

## Visual rules

- Use tokens from `design-systems/ddato-drive/tokens.css`.
- Keep list view as the default.
- The toolbar should be stable and not resize during upload.
- Admin mode must clearly show which user's files are being viewed.
