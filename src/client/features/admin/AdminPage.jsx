import { FolderOpen, Gauge, KeyRound, RefreshCcw, Save, ScrollText, Shield, Trash2, UserCheck, UserPlus, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ProgressBar } from "../../shared/components/ProgressBar.jsx";
import { formatBytes, quotaPercent } from "../../shared/lib/formatBytes.js";
import { formatDate } from "../../shared/lib/dates.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { DrivePage } from "../files/DrivePage.jsx";
import { AdminAuditLog } from "./AdminAuditLog.jsx";
import { AdminSystemDashboard } from "./AdminSystemDashboard.jsx";
import { adminApi } from "./adminApi.js";

const adminTabs = [
  { id: "system", label: "시스템", icon: Gauge },
  { id: "users", label: "사용자 관리", icon: UsersRound },
  { id: "files", label: "파일 열람", icon: FolderOpen },
  { id: "audit", label: "감사 로그", icon: ScrollText }
];

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [system, setSystem] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [quotaMb, setQuotaMb] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [role, setRole] = useState("user");
  const [activeTab, setActiveTab] = useState("system");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedId) || users[0] || null, [users, selectedId]);
  const isAuditTab = activeTab === "audit";
  const isUsersTab = activeTab === "users";

  useEffect(() => {
    if (!selectedUser) return;
    setSelectedId(selectedUser.id);
    setUnlimited(selectedUser.quotaBytes == null);
    setQuotaMb(selectedUser.quotaBytes == null ? "" : String(Math.round(selectedUser.quotaBytes / (1024 * 1024))));
    setRole(selectedUser.role || "user");
  }, [selectedUser?.id]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const [usersResult, systemResult, auditResult] = await Promise.all([
        adminApi.users(),
        adminApi.system(),
        adminApi.audit({ limit: 100 })
      ]);
      setUsers(usersResult.users);
      setSystem(systemResult.system);
      setAuditLogs(auditResult.logs);
      if (!selectedId && usersResult.users[0]) setSelectedId(usersResult.users[0].id);
    } catch (nextError) {
      setError(nextError.message || "관리 정보를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuota() {
    if (!selectedUser) return;
    try {
      await adminApi.updateQuota(selectedUser.id, unlimited ? { unlimited: true } : { quotaMb: Number(quotaMb || 0) });
      await load();
    } catch (nextError) {
      setError(nextError.message || "용량을 저장하지 못했습니다.");
    }
  }

  async function saveRole() {
    if (!selectedUser) return;
    try {
      await adminApi.updateRole(selectedUser.id, role);
      await load();
    } catch (nextError) {
      setError(nextError.message || "권한을 저장하지 못했습니다.");
    }
  }

  async function createUser(payload) {
    try {
      const result = await adminApi.createUser(payload);
      setSelectedId(result.user.id);
      await load();
    } catch (nextError) {
      setError(nextError.message || "사용자를 추가하지 못했습니다.");
      throw nextError;
    }
  }

  async function disableUser() {
    if (!selectedUser || selectedUser.role === "admin") return;
    if (!window.confirm(`${selectedUser.id} 계정을 비활성화할까요?`)) return;
    try {
      await adminApi.disableUser(selectedUser.id);
      await load();
    } catch (nextError) {
      setError(nextError.message || "사용자를 비활성화하지 못했습니다.");
    }
  }

  async function enableUser() {
    if (!selectedUser) return;
    try {
      await adminApi.enableUser(selectedUser.id);
      await load();
    } catch (nextError) {
      setError(nextError.message || "사용자를 활성화하지 못했습니다.");
    }
  }

  async function deleteUser() {
    if (!selectedUser || selectedUser.role === "admin") return;
    const message = `${selectedUser.id} 사용자를 삭제할까요?\n이 사용자의 파일, 휴지통, 공유 링크, 로그인 세션이 모두 삭제됩니다.`;
    if (!window.confirm(message)) return;
    try {
      await adminApi.deleteUser(selectedUser.id);
      setSelectedId("");
      await load();
    } catch (nextError) {
      setError(nextError.message || "사용자를 삭제하지 못했습니다.");
    }
  }

  async function unlockUserLogin() {
    if (!selectedUser) return;
    try {
      await adminApi.unlockUserLogin(selectedUser.id);
      await load();
    } catch (nextError) {
      setError(nextError.message || "로그인 잠금을 해제하지 못했습니다.");
    }
  }

  async function saveDefaultQuota(defaultQuotaMb) {
    try {
      await adminApi.updateDefaultQuota({ quotaMb: defaultQuotaMb });
      await load();
    } catch (nextError) {
      setError(nextError.message || "기본 저장소 크기를 저장하지 못했습니다.");
    }
  }

  return (
    <div className={isUsersTab ? "admin-layout users-mode" : "admin-layout"}>
      <section className="admin-main">
        <aside className="admin-navigation">
          <div className="admin-navigation-title">
            <span className="admin-navigation-icon"><Shield size={18} /></span>
            <span>관리</span>
          </div>
          <nav className="admin-tabs" role="tablist" aria-label="관리자 탭">
            {adminTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} aria-label={tab.label} title={tab.label}>
                  <Icon size={17} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="admin-navigation-footer">
            {system ? (
              <div>
                <span>프로젝트 저장소</span>
                <strong>{formatBytes(system.project.usedBytes)} / {formatBytes(system.project.totalBytes)}</strong>
              </div>
            ) : null}
            <Button icon={RefreshCcw} onClick={load} disabled={busy}>새로고침</Button>
          </div>
        </aside>

        <section className="admin-content">
          <header className="admin-content-header">
            <div>
              <span>DDATO Drive</span>
              <h1>{adminTabs.find((tab) => tab.id === activeTab)?.label}</h1>
            </div>
          </header>
          {error ? <div className="error-banner page-error">{error}</div> : null}
          {activeTab === "system" ? <SystemTab system={system} onRefresh={load} onSaveDefaultQuota={saveDefaultQuota} busy={busy} /> : null}
          {activeTab === "users" ? <UsersTab users={users} selectedUser={selectedUser} onSelect={setSelectedId} onCreateUser={createUser} defaultQuotaMb={system?.settings?.defaultQuotaMb || 1024} /> : null}
          {activeTab === "files" ? <FileAccessTab users={users} selectedUser={selectedUser} onSelect={setSelectedId} /> : null}
          {isAuditTab ? <AuditTab logs={auditLogs} onRefresh={load} busy={busy} /> : null}
        </section>
      </section>

      {isUsersTab && selectedUser ? (
        <aside className="side-panel">
          <div className="panel-header">
            <div className="panel-title">
              <Shield size={18} />
              <span>{selectedUser.id}</span>
            </div>
            <button className="admin-user-panel-close" type="button" onClick={() => setSelectedId("")} aria-label="사용자 상세 닫기" title="닫기">
              <X size={17} />
            </button>
          </div>
          <div className="panel-body quota-editor">
            <ProgressBar value={quotaPercent(selectedUser.usageBytes, selectedUser.quotaBytes)} label={selectedUser.quotaBytes == null ? `${formatBytes(selectedUser.usageBytes)} 사용 / 무제한` : `${formatBytes(selectedUser.usageBytes)} / ${formatBytes(selectedUser.quotaBytes)}`} />
            <label className="field">
              <span>용량 MB</span>
              <input value={quotaMb} onChange={(event) => setQuotaMb(event.target.value)} disabled={unlimited} inputMode="numeric" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} />
              <span>무제한</span>
            </label>
            <Button icon={Save} variant="primary" onClick={saveQuota}>용량 저장</Button>
            <label className="field">
              <span>권한</span>
              <select value={role} onChange={(event) => setRole(event.target.value)} disabled={isProtectedRoleTarget(selectedUser, currentUser)}>
                <option value="user">사용자</option>
                <option value="admin">관리자</option>
              </select>
            </label>
            <Button icon={Shield} onClick={saveRole} disabled={isProtectedRoleTarget(selectedUser, currentUser) || role === selectedUser.role}>권한 저장</Button>
            <UserLoginState user={selectedUser} />
            <Button icon={KeyRound} onClick={unlockUserLogin} disabled={!hasLoginRestriction(selectedUser)}>로그인 잠금 해제</Button>
            {selectedUser.disabledAt ? (
              <Button icon={UserCheck} onClick={enableUser}>사용자 활성화</Button>
            ) : (
              <Button icon={Trash2} variant="danger" onClick={disableUser} disabled={selectedUser.role === "admin"}>사용자 비활성화</Button>
            )}
            <Button icon={Trash2} variant="danger" onClick={deleteUser} disabled={selectedUser.role === "admin"}>사용자 삭제</Button>
            <p className="muted">선택한 사용자의 용량과 로그인 보안을 관리합니다.</p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function SystemTab({ system, onRefresh, onSaveDefaultQuota, busy }) {
  return (
    <div className="admin-tab-panel system-tab">
      <AdminSystemDashboard system={system} onRefresh={onRefresh} onSaveDefaultQuota={onSaveDefaultQuota} busy={busy} />
    </div>
  );
}

function UsersTab({ users, selectedUser, onSelect, onCreateUser, defaultQuotaMb = 1024 }) {
  const [newId, setNewId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newQuotaMb, setNewQuotaMb] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setNewQuotaMb((value) => value || String(defaultQuotaMb));
  }, [defaultQuotaMb]);

  async function handleCreate(event) {
    event.preventDefault();
    setCreating(true);
    try {
      await onCreateUser({
        id: newId,
        password: newPassword,
        quotaMb: Number(newQuotaMb || defaultQuotaMb)
      });
      setNewId("");
      setNewPassword("");
      setNewQuotaMb(String(defaultQuotaMb));
    } finally {
      setCreating(false);
    }
  }

  if (!selectedUser) {
    return (
      <div className="admin-tab-panel users-tab">
        <CreateUserForm
          newId={newId}
          newPassword={newPassword}
          newQuotaMb={newQuotaMb}
          creating={creating}
          onSubmit={handleCreate}
          onIdChange={setNewId}
          onPasswordChange={setNewPassword}
          onQuotaChange={setNewQuotaMb}
        />
        <EmptyState title="관리할 사용자가 없습니다" body="사용자를 추가하면 이곳에 표시됩니다." />
      </div>
    );
  }

  return (
    <div className="admin-tab-panel users-tab">
      <CreateUserForm
        newId={newId}
        newPassword={newPassword}
        newQuotaMb={newQuotaMb}
        creating={creating}
        onSubmit={handleCreate}
        onIdChange={setNewId}
        onPasswordChange={setNewPassword}
        onQuotaChange={setNewQuotaMb}
      />
      <div className="admin-list">
        {users.map((user) => (
          <button key={user.id} className={selectedUser.id === user.id ? "user-row selected" : "user-row"} onClick={() => onSelect(user.id)}>
            <span className="file-name">
              <Shield size={18} />
              <span>
                <strong>{user.id}</strong>
                <span>{user.role} · {providerLabel(user)}{user.googleEmail ? ` · ${user.googleEmail}` : ""}{userStatusLabel(user) ? ` · ${userStatusLabel(user)}` : ""}</span>
              </span>
            </span>
            <span className="file-meta right">{formatBytes(user.usageBytes)}</span>
            <span className="file-meta right">{user.quotaBytes == null ? "무제한" : formatBytes(user.quotaBytes)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateUserForm({ newId, newPassword, newQuotaMb, creating, onSubmit, onIdChange, onPasswordChange, onQuotaChange }) {
  return (
    <form className="admin-create-user" onSubmit={onSubmit} autoComplete="off">
      <label className="field">
        <span>아이디</span>
        <input value={newId} onChange={(event) => onIdChange(event.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input type="password" value={newPassword} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="new-password" />
      </label>
      <label className="field">
        <span>용량 MB</span>
        <input value={newQuotaMb} onChange={(event) => onQuotaChange(event.target.value)} inputMode="numeric" />
      </label>
      <Button icon={UserPlus} variant="primary" type="submit" disabled={creating}>{creating ? "추가 중" : "사용자 추가"}</Button>
    </form>
  );
}

function FileAccessTab({ users, selectedUser, onSelect }) {
  const [mode, setMode] = useState("files");

  if (!selectedUser) {
    return <EmptyState title="열람할 사용자가 없습니다" body="회원가입이 이루어지면 사용자 파일을 관리자 권한으로 확인할 수 있습니다." />;
  }

  const trashMode = mode === "trash";

  return (
    <div className="admin-tab-panel admin-file-tab">
      <div className="admin-file-tab-header">
        <label className="field admin-user-select">
          <span>사용자</span>
          <select value={selectedUser.id} onChange={(event) => onSelect(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.id}</option>
            ))}
          </select>
        </label>
        <div className="admin-file-mode" role="group" aria-label="파일 열람 범위">
          <button type="button" className={mode === "files" ? "active" : ""} onClick={() => setMode("files")}>
            <FolderOpen size={16} />
            <span>파일</span>
          </button>
          <button type="button" className={mode === "trash" ? "active" : ""} onClick={() => setMode("trash")}>
            <Trash2 size={16} />
            <span>휴지통</span>
          </button>
        </div>
        <span className="muted">{selectedUser.id} {trashMode ? "휴지통" : "파일"}을 관리자 권한으로 열람합니다.</span>
      </div>
      <div className="admin-file-tab-body">
        <DrivePage
          key={`${selectedUser.id}-${mode}`}
          ownerId={selectedUser.id}
          ownerLabel={`${selectedUser.id} ${trashMode ? "휴지통" : "파일"}`}
          trashMode={trashMode}
          allowAdminPasswordReset
        />
      </div>
    </div>
  );
}

function UserLoginState({ user }) {
  const lockUntil = Number(user.loginLockedUntil || 0);
  const isLocked = lockUntil > Date.now();
  return (
    <div className="security-summary">
      <div className="security-row">
        <span>계정 방식</span>
        <strong>{providerLabel(user)}</strong>
      </div>
      {user.googleEmail ? (
        <div className="security-row">
          <span>Google 이메일</span>
          <strong>{user.googleEmail}</strong>
        </div>
      ) : null}
      <div className="security-row">
        <span>로그인 상태</span>
        <strong>{userStatusLabel(user) || "정상"}</strong>
      </div>
      <div className="security-row">
        <span>비밀번호 오류</span>
        <strong>{user.loginFailedCount || 0}회</strong>
      </div>
      {isLocked ? (
        <div className="security-row">
          <span>해제 시각</span>
          <strong>{formatDate(lockUntil)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function hasLoginRestriction(user) {
  if (!user) return false;
  const lockUntil = Number(user.loginLockedUntil || 0);
  return Boolean(user.loginSuspendedAt || lockUntil > Date.now() || Number(user.loginFailedCount || 0) > 0);
}

function isProtectedRoleTarget(selectedUser, currentUser) {
  if (!selectedUser) return true;
  return selectedUser.id === "admin" || selectedUser.id === currentUser?.id;
}

function providerLabel(user) {
  return user?.authProvider === "google" ? "Google" : "아이디";
}

function userStatusLabel(user) {
  if (!user) return "";
  if (user.disabledAt) return "비활성";
  if (user.loginSuspendedAt) return "일시정지";
  if (Number(user.loginLockedUntil || 0) > Date.now()) return "로그인 잠금";
  if (Number(user.loginFailedCount || 0) > 0) return `오류 ${user.loginFailedCount}회`;
  return "";
}

function AuditTab({ logs, onRefresh, busy }) {
  return (
    <div className="admin-audit-tab">
      <AdminAuditLog logs={logs} onRefresh={onRefresh} busy={busy} />
    </div>
  );
}
