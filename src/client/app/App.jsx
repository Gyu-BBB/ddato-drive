import { FileText, Folder, HardDrive, Images, LogOut, Shield, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { AdminPage } from "../features/admin/AdminPage.jsx";
import { AdminLoginPage } from "../features/auth/AdminLoginPage.jsx";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider.jsx";
import { LoginPage } from "../features/auth/LoginPage.jsx";
import { ProfileDialog } from "../features/auth/ProfileDialog.jsx";
import { DrivePage } from "../features/files/DrivePage.jsx";
import { MediaViewerPage } from "../features/files/MediaViewerPage.jsx";
import { PublicSharePage } from "../features/files/PublicSharePage.jsx";
import { NotesPage } from "../features/notes/NotesPage.jsx";
import { IconButton } from "../shared/components/IconButton.jsx";

export function App() {
  const publicShareToken = getPublicShareToken();
  if (publicShareToken) return <PublicSharePage token={publicShareToken} />;

  return (
    <AuthProvider>
      <AppFrame />
    </AuthProvider>
  );
}

function getPublicShareToken() {
  const match = window.location.pathname.match(/^\/share\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function AppFrame() {
  const { user, loading, logout } = useAuth();
  const isAdminLoginPath = window.location.pathname === "/admin-login";
  const [view, setView] = useState("drive");
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

  function goHome() {
    setView("drive");
    setHomeSignal((value) => value + 1);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-mark" type="button" onClick={goHome} title="홈으로 이동" aria-label="홈으로 이동">
          <HardDrive size={22} />
        </button>

        <nav className="nav-stack" aria-label="주 메뉴">
          <button className={view === "drive" ? "nav-item active" : "nav-item"} onClick={() => setView("drive")} title="드라이브" aria-label="드라이브">
            <Folder size={18} />
          </button>
          <button className={view === "media" ? "nav-item active" : "nav-item"} onClick={() => setView("media")} title="이미지/동영상" aria-label="이미지/동영상">
            <Images size={18} />
          </button>
          <button className={view === "notes" ? "nav-item active" : "nav-item"} onClick={() => setView("notes")} title="메모장" aria-label="메모장">
            <FileText size={18} />
          </button>
          <button className={view === "trash" ? "nav-item active" : "nav-item"} onClick={() => setView("trash")} title="휴지통" aria-label="휴지통">
            <Trash2 size={18} />
          </button>
          {isAdmin && (
            <button className={view === "admin" ? "nav-item active" : "nav-item"} onClick={() => setView("admin")} title="관리" aria-label="관리">
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
            ? <DrivePage trashMode ownerLabel="휴지통" />
            : view === "media"
              ? <MediaViewerPage />
              : view === "notes"
                ? <NotesPage />
                : <DrivePage homeSignal={homeSignal} />}
      </section>
      {profileOpen ? <ProfileDialog onClose={() => setProfileOpen(false)} /> : null}
    </main>
  );
}
