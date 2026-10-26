import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Link } from 'react-router';
import { apiRequest } from '../../shared/api/apiClient.js';
import { Button } from '../../shared/components/Button.jsx';
import { formatBytes, quotaPercent } from '../../shared/lib/formatBytes.js';
import { ProgressBar } from '../../shared/components/ProgressBar.jsx';
import { drivePath } from '../../app/appRoutes.js';
import { filePath } from './fileDisplay.js';
import '../../shared/components/management.css';
import './storageUsage.css';
const labels = { image: '사진', video: '동영상', audio: '오디오', archive: '압축 파일', document: '문서', other: '기타' };

export function StorageUsagePage() {
  const [storage, setStorage] = useState(null); const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false; setBusy(true); setError('');
    apiRequest('/api/storage-insights').then(result => { if (!disposed) setStorage(result.storage); })
      .catch(error => { if (!disposed) setError(error.message); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [refresh]);
  return <section className="management-page">
    <header className="management-header"><h1>저장 공간</h1><Button icon={RefreshCcw} iconOnly disabled={busy} onClick={() => setRefresh(value => value + 1)}>새로고침</Button></header>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    <div className="management-scroll" aria-busy={busy}>
      {!storage ? <p>불러오는 중</p> : <>
        <dl className="storage-totals">
          {[['전체 용량', storage.quotaBytes == null ? '무제한' : formatBytes(storage.quotaBytes)], ['사용 중', formatBytes(storage.usedBytes)], ['남은 용량', storage.freeBytes == null ? '무제한' : formatBytes(storage.freeBytes)], ['업로드 예약', formatBytes(storage.pendingBytes)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {storage.quotaBytes != null ? <ProgressBar value={quotaPercent(storage.usedBytes, storage.quotaBytes)} label={`${formatBytes(storage.usedBytes)} 사용 중`} /> : null}
        <section className="storage-section"><h2>파일 종류별 사용량</h2>
          {storage.kinds.length ? storage.kinds.map(kind => <div className={`storage-kind kind-${kind.kind}`} key={kind.kind}><span>{labels[kind.kind]} · {kind.count}개</span><strong>{formatBytes(kind.bytes)}</strong><progress max={Math.max(1, storage.activeBytes)} value={kind.bytes} /></div>) : <p className="muted">저장된 파일이 없습니다.</p>}
          <p>휴지통 <strong>{formatBytes(storage.trashBytes)}</strong> · <Link to="/trash">휴지통 열기</Link></p>
        </section>
        <section className="storage-section"><h2>용량이 큰 파일</h2>
          {storage.largest.map(file => <div className="storage-file" key={file.id}><div><Link to={drivePath(file.parentId)}>{file.name}</Link><small>{filePath(file)}</small></div><strong>{formatBytes(file.sizeBytes)}</strong></div>)}
        </section>
        {storage.users ? <section className="storage-section"><h2>사용자별 사용량</h2>{storage.users.map(user => <div className="storage-file" key={user.id}><div><Link to={`/admin/users?owner=${encodeURIComponent(user.id)}`}>{user.id}</Link><small>휴지통 {formatBytes(user.trashBytes)}</small></div><strong>{formatBytes(user.usedBytes)} / {user.quotaBytes == null ? '무제한' : formatBytes(user.quotaBytes)}</strong></div>)}</section> : null}
      </>}
    </div>
  </section>;
}
