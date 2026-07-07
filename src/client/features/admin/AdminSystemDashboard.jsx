import { Database, HardDrive, RefreshCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../shared/components/Button.jsx";
import { ProgressBar } from "../../shared/components/ProgressBar.jsx";
import { formatBytes, quotaPercent } from "../../shared/lib/formatBytes.js";

export function AdminSystemDashboard({ system, onRefresh, onSaveDefaultQuota, busy = false }) {
  const [defaultQuotaMb, setDefaultQuotaMb] = useState("");

  useEffect(() => {
    if (!system?.settings) return;
    setDefaultQuotaMb(String(system.settings.defaultQuotaMb ?? ""));
  }, [system?.settings?.defaultQuotaMb]);

  if (!system) return null;
  const settings = system.settings || { defaultQuotaBytes: 0, defaultQuotaMb: 0 };

  async function saveDefaultQuota() {
    await onSaveDefaultQuota?.(Number(defaultQuotaMb || 0));
  }

  return (
    <section className="admin-dashboard">
      <StatusCard
        icon={HardDrive}
        title="프로젝트 디스크"
        value={`${formatBytes(system.project.usedBytes)} / ${formatBytes(system.project.totalBytes)}`}
        label={`남은 할당량 ${formatBytes(system.project.freeBytes)}`}
        progress={system.project.usedPercent}
      />
      <StatusCard
        icon={Database}
        title="파일 저장소"
        value={formatBytes(system.storage.storageBytes)}
        label={`활성 파일 ${formatBytes(system.storage.usedBytes)} · ${system.storage.files}개`}
      />
      <StatusCard
        icon={HardDrive}
        title="실제 디스크"
        value={`${formatBytes(system.disk.freeBytes)} 여유`}
        label={`Mac 디스크 사용률 ${system.disk.usedPercent}%`}
        progress={system.disk.usedPercent}
      />
      <div className="admin-dashboard-actions">
        <Button icon={RefreshCcw} onClick={onRefresh} disabled={busy}>상태 새로고침</Button>
      </div>
      <article className="status-card system-setting-card">
        <header>
          <Database size={17} />
          <span>기본 저장소</span>
        </header>
        <strong>{formatBytes(settings.defaultQuotaBytes)}</strong>
        <label className="field compact-field">
          <span>신규 사용자 기본 용량 MB</span>
          <input value={defaultQuotaMb} onChange={(event) => setDefaultQuotaMb(event.target.value)} inputMode="decimal" />
        </label>
        <Button icon={Save} variant="primary" onClick={saveDefaultQuota} disabled={busy}>기본 용량 저장</Button>
      </article>
      <div className="system-breakdown">
        <span>DB {formatBytes(system.storage.dbBytes)}</span>
        <span>미리보기 캐시 {formatBytes(system.storage.previewCacheBytes)}</span>
        <span>휴지통 {formatBytes(system.storage.trashBytes)}</span>
        <span>임시 파일 {formatBytes(system.storage.tempBytes)}</span>
      </div>
    </section>
  );
}

function StatusCard({ icon: Icon, title, value, label, progress = null }) {
  return (
    <article className="status-card">
      <header>
        <Icon size={17} />
        <span>{title}</span>
      </header>
      <strong>{value}</strong>
      {progress == null ? <small>{label}</small> : <ProgressBar value={quotaPercent(progress, 100)} label={label} />}
    </article>
  );
}
