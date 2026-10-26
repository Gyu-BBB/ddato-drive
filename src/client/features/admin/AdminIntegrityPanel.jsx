import { useEffect, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '../../shared/components/Button.jsx';
import { adminApi } from './adminApi.js';

const labels = { missing: '실제 파일 없음', size_mismatch: '크기 불일치', orphan: 'DB 기록 없음', invalid_path: '경로 오류', not_regular_file: '일반 파일 아님', unreadable: '읽기 실패' };

export function AdminIntegrityPanel() {
  const [report, setReport] = useState({ state: 'idle' });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer;
    async function poll() {
      try {
        const result = await adminApi.integrity();
        if (disposed) return;
        setReport(result.report);
        if (result.report.state === 'running') timer = setTimeout(poll, 1500);
      } catch (error) { if (!disposed) setError(error.message); }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [report.startedAt, report.state === 'running']);
  async function start() {
    setError('');
    try { setReport((await adminApi.startIntegrity()).report); }
    catch (error) { setError(error.message); }
  }
  return <section className="system-breakdown" style={{ gridColumn: '1 / -1', display: 'block' }}>
    <h2 style={{ fontSize: 16 }}>저장소 무결성</h2>
    <Button icon={ScanLine} onClick={start} disabled={report.state === 'running'}>{report.state === 'running' ? '점검 중' : '읽기 전용 점검'}</Button>
    {error || report.error ? <p role="alert">{error || report.error}</p> : null}
    {report.startedAt ? <p role="status">확인 {report.checked}개 · 이상 {report.issueCount}개 · {report.state === 'done' ? '완료' : report.state === 'running' ? '진행 중' : '중단'}</p> : null}
    <ul style={{ maxHeight: 240, overflow: 'auto', overflowWrap: 'anywhere' }}>{report.issues?.map((issue, index) => <li key={index}>{labels[issue.kind]} · {issue.ownerId ? `${issue.ownerId} / ` : ''}{issue.name}</li>)}</ul>
    {report.truncated ? <p>최초 200건 표시</p> : null}
  </section>;
}
