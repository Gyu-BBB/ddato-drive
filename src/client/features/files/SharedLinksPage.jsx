import { useEffect, useState } from 'react';
import { Copy, Link2Off, RefreshCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../shared/components/Button.jsx';
import { formatDate } from '../../shared/lib/dates.js';
import { shareApi } from './shareApi.js';
import '../../shared/components/management.css';

export function SharedLinksPage() {
  const [state, setState] = useState('all');
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ shares: [], total: 0 });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false; setBusy(true); setError('');
    shareApi.listOwned(state, page).then(result => { if (!disposed) { setData(result); setSelected([]); } })
      .catch(error => { if (!disposed) setError(error.message); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [state, page, refresh]);
  async function revoke() {
    if (!window.confirm(`${selected.length}개 공유 링크를 해제할까요?`)) return;
    setBusy(true);
    try { await shareApi.revokeOwned(selected); setRefresh(value => value + 1); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); }
    catch { setError('링크를 복사하지 못했습니다. 보안 연결에서 다시 시도해 주세요.'); }
  }
  const available = data.shares.filter(share => !share.revokedAt).map(share => share.id);
  return <section className="management-page">
    <header className="management-header"><h1>공유 링크</h1>
      <select aria-label="공유 상태" value={state} onChange={event => { setState(event.target.value); setPage(0); }}>
        <option value="all">전체</option><option value="active">공유 중</option><option value="expired">만료됨</option><option value="revoked">해제됨</option>
      </select>
      <Button icon={Link2Off} onClick={revoke} disabled={busy || !selected.length}>선택 해제</Button>
      <Button icon={RefreshCcw} iconOnly onClick={() => setRefresh(value => value + 1)} disabled={busy}>새로고침</Button>
    </header>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    <div className="management-scroll" aria-busy={busy}>
      <label className="management-select"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={Boolean(available.length) && available.every(id => selected.includes(id))} disabled={busy || !available.length} onChange={event => setSelected(event.target.checked ? available : [])} />전체 선택 · {data.total}개</label>
      {!data.shares.length ? <p className="muted">{busy ? '불러오는 중' : '공유 링크가 없습니다.'}</p> : null}
      {data.shares.map(share => <article className="management-row" key={share.id}>
        <input type="checkbox" aria-label={`${share.name} 공유 선택`} checked={selected.includes(share.id)} disabled={busy || Boolean(share.revokedAt)} onChange={event => setSelected(ids => event.target.checked ? [...ids, share.id] : ids.filter(id => id !== share.id))} />
        <div className="management-name"><strong>{share.name}</strong><small>{share.path}</small></div>
        <div><span>{share.revokedAt ? '해제됨' : share.expiresAt && share.expiresAt <= Date.now() ? '만료됨' : '공유 중'}</span><small>{share.expiresAt ? formatDate(share.expiresAt) : '무제한'} · {share.passwordEnabled ? '암호 있음' : '암호 없음'}</small></div>
        <Button icon={Copy} iconOnly onClick={() => copy(share.url)} disabled={Boolean(share.revokedAt) || Boolean(share.expiresAt && share.expiresAt <= Date.now())}>링크 복사</Button>
      </article>)}
    </div>
    <footer className="management-header"><Button icon={ChevronLeft} iconOnly disabled={busy || page === 0} onClick={() => setPage(page - 1)}>이전</Button><span>{page + 1} / {Math.max(1, Math.ceil(data.total / 100))}</span><Button icon={ChevronRight} iconOnly disabled={busy || (page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>다음</Button></footer>
  </section>;
}
