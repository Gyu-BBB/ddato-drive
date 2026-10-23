import { FileText, Folder, HardDrive, Images, LogOut, Shield, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { AdminPage } from "../features/admin/AdminPage.jsx";
import { AdminLoginPage } from "../features/auth/AdminLoginPage.jsx";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider.jsx";
import { LoginPage } from "../features/auth/LoginPage.jsx";
import { ProfileDialog } from "../features/auth/ProfileDialog.jsx";
import { DriveRoute } from "./DriveRoute.jsx";
import { appPage, drivePath, normalizePathname } from "./appRoutes.js";
import { MediaViewerPage } from "../features/files/MediaViewerPage.jsx";
import { PublicSharePage } from "../features/files/PublicSharePage.jsx";
import { NotesPage } from "../features/notes/NotesPage.jsx";
import { IconButton } from "../shared/components/IconButton.jsx";
import { DownloadQueue } from "../features/files/components/DownloadQueue.jsx";

export function App() {
  return (
    <Routes>
      <Route path="/share/:token" element={<ShareRoute />} />
      <Route path="*" element={<AuthProvider><AppFrame /><DownloadQueue /></AuthProvider>} />
    </Routes>
  );
}
function ShareRoute() {
  const { token } = useParams();
  return <><PublicSharePage key={token} token={token} /><DownloadQueue /></>;
}

function AppFrame() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminLoginPath = ["/admin/login", "/admin-login"].includes(normalizePathname(location.pathname));
  const view = appPage(location.pathname);
  const [homeSignal, setHomeSignal] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  if (loading) {
    return (
      <main className="boot-screen">
        <HardDrive size={36} />
        <p>DDATO Drive</p>
      </main>
    );
  }

  if (isAdminLoginPath) {
    return <AdminLoginPage />;
  }

  if (!user) {
    return <LoginPage />;
  }

  const isAdmin = user.role === "admin";
  if (!view || (view === "admin" && !isAdmin)) return <Navigate to="/" replace />;

  function goHome() {
    if (location.pathname !== "/" || location.search) navigate("/");
    setHomeSignal((value) => value + 1);
  }

  function openMediaLocation(file) {
    navigate(drivePath(file.path?.at(-1)?.id));
  }

  function goPage(path) {
    if (`${location.pathname}${location.search}` !== path) navigate(path);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-mark" type="button" onClick={goHome} title="홈으로 이동" aria-label="홈으로 이동">
          <HardDrive size={22} />
        </button>

        <nav className="nav-stack" aria-label="주 메뉴">
          <button data-section="drive" className={view === "drive" ? "nav-item active" : "nav-item"} onClick={goHome} title="홈" aria-label="홈으로 이동">
            <Folder size={18} />
          </button>
          <button data-section="media" className={view === "media" ? "nav-item active" : "nav-item"} onClick={() => goPage("/media")} title="이미지/동영상" aria-label="이미지/동영상">
            <Images size={18} />
          </button>
          <button data-section="notes" className={view === "notes" ? "nav-item active" : "nav-item"} onClick={() => goPage("/notes")} title="메모장" aria-label="메모장">
            <FileText size={18} />
          </button>
          <button data-section="trash" className={view === "trash" ? "nav-item active" : "nav-item"} onClick={() => goPage("/trash")} title="휴지통" aria-label="휴지통">
            <Trash2 size={18} />
          </button>
          {isAdmin && (
            <button data-section="admin" className={view === "admin" ? "nav-item active" : "nav-item"} onClick={() => goPage("/admin")} title="관리" aria-label="관리">
              <Shield size={18} />
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="account-chip" type="button" onClick={() => setProfileOpen(true)} title="계정 설정" aria-label="계정 설정">
            <UserRound size={17} />
          </button>
          <IconButton label="로그아웃" icon={LogOut} onClick={logout} />
        </div>
      </aside>

      <section className="workspace">
        {view === "admin" && isAdmin
          ? <AdminPage />
          : view === "trash"
            ? <DriveRoute key="trash" trashMode ownerLabel="휴지통" />
            : view === "media"
              ? <MediaViewerPage onOpenLocation={openMediaLocation} />
              : view === "notes"
                ? <NotesPage />
                : <DriveRoute key="drive" homeSignal={homeSignal} allowAdminPasswordReset={isAdmin} />}
      </section>
      {profileOpen ? <ProfileDialog onClose={() => setProfileOpen(false)} /> : null}
    </main>
  );
}
