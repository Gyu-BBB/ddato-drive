import { Activity, RefreshCcw } from "lucide-react";
import { Button } from "../../shared/components/Button.jsx";
import { formatDate } from "../../shared/lib/dates.js";

export function AdminAuditLog({ logs = [], onRefresh, busy = false }) {
  return (
    <section className="audit-panel">
      <header className="audit-header">
        <div className="panel-title">
          <Activity size={18} />
          <span>감사 로그</span>
        </div>
        <Button icon={RefreshCcw} iconOnly onClick={onRefresh} disabled={busy}>감사 로그 새로고침</Button>
      </header>
      <div className="audit-list">
        {logs.length ? logs.map((log) => (
          <article className="audit-row" key={log.id}>
            <strong>{labelAction(log.action)}</strong>
            <span>{log.userId || "공개 접근"} · {log.ip || "-"}</span>
            <span>{log.targetId || "-"}</span>
            <time>{formatDate(log.createdAt)}</time>
          </article>
        )) : (
          <div className="audit-empty">표시할 로그가 없습니다.</div>
        )}
      </div>
    </section>
  );
}

function labelAction(action) {
  const labels = {
    "auth.login": "로그인",
    "auth.google.login": "Google 로그인",
    "auth.login.failed": "로그인 실패",
    "auth.register": "회원가입",
    "auth.profile.update": "프로필 변경",
    "file.upload": "파일 업로드",
    "file.delete": "삭제",
    "file.duplicate": "복제",
    "trash.restore": "복원",
    "trash.purge": "영구 삭제",
    "trash.auto_purge": "휴지통 자동 영구 삭제",
    "file.share.create": "공유 생성",
    "file.share.revoke": "공유 해제",
    "share.public.view": "공유 열람",
    "share.public.download": "공유 다운로드",
    "share.public.preview": "공유 미리보기",
    "admin.quota.update": "용량 변경",
    "admin.role.update": "권한 변경",
    "admin.user.create": "사용자 추가",
    "admin.user.disable": "사용자 비활성화",
    "admin.user.enable": "사용자 활성화",
    "admin.user.delete": "사용자 삭제",
    "admin.user.unlock": "로그인 잠금 해제",
    "admin.file.password.reset": "파일 2차 암호 초기화",
    "admin.note.password.reset": "메모 2차 암호 초기화",
    "admin.settings.default_quota.update": "기본 저장소 변경"
  };
  return labels[action] || action;
}
