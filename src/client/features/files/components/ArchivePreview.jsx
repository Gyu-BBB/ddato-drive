import { ArrowLeft, File, Home, LockKeyhole, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatBytes } from '../../../shared/lib/formatBytes.js';
import { FolderGlyph } from './FolderGlyph.jsx';

export function ArchivePreview({ archive }) {
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(200);
  const entries = archive?.entries || [];
  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (search) return entries.filter(entry => entry.path.toLowerCase().includes(search));
    const children = new Map();
    for (const entry of entries) {
      if (!entry.path.startsWith(folder)) continue;
      const relative = entry.path.slice(folder.length);
      if (!relative) continue;
      const slash = relative.indexOf('/');
      const path = slash >= 0 ? folder + relative.slice(0, slash + 1) : entry.path;
      if (!children.has(path)) children.set(path, slash >= 0 ? { path, directory: true } : entry);
    }
    return [...children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path, 'ko', { numeric: true }));
  }, [entries, folder, query]);
  const segments = folder.split('/').filter(Boolean);
  const navigate = path => { setFolder(path); setQuery(''); setLimit(200); };
  if (!archive) return <span className="muted">압축 파일 목록을 불러오는 중입니다.</span>;
  return (
    <section className="zip-preview" aria-label="압축 파일 내용">
      <header className="zip-preview-summary"><strong>{archive.totalEntries}개{archive.countIsPartial ? ' 이상' : ''} 항목</strong><span>{entries.some(entry => entry.sizeBytes == null) ? '원본 용량 확인 불가' : `${archive.truncated ? '표시 항목 용량' : '원본'} ${formatBytes(entries.reduce((sum, entry) => sum + entry.sizeBytes, 0))}`}</span></header>
      <nav className="zip-preview-path" aria-label="압축 파일 내부 경로">
        <button type="button" title="이전 폴더" aria-label="압축 파일 이전 폴더" disabled={!folder} onClick={() => navigate(segments.slice(0, -1).join('/') + (segments.length > 1 ? '/' : ''))}><ArrowLeft size={15} /></button>
        <button type="button" title="압축 파일 홈" aria-label="압축 파일 홈" onClick={() => navigate('')}><Home size={15} /></button>
        {segments.map((segment, index) => <button type="button" key={index} onClick={() => navigate(segments.slice(0, index + 1).join('/') + '/')}>{segment}</button>)}
      </nav>
      <label className="zip-preview-search"><Search size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setLimit(200); }} placeholder="압축 파일 내 검색" /></label>
      {archive.truncated ? <p className="zip-preview-notice">목록은 처음 10,000개 항목까지 표시됩니다.</p> : null}
      <div className="zip-preview-list">
        {!rows.length ? <p className="muted">표시할 항목이 없습니다.</p> : null}
        {rows.slice(0, limit).map((entry, index) => <div className="zip-preview-row" key={`${entry.path}-${index}`}>
          {entry.directory ? <FolderGlyph size={20} color="yellow" /> : <File size={19} />}
          <div className="zip-preview-name">
            {entry.directory ? <button type="button" onClick={() => navigate(entry.path.endsWith('/') ? entry.path : entry.path + '/')}>{entry.path.replace(/\/$/, '').split('/').at(-1)}</button> : <strong>{entry.path.split('/').at(-1)}</strong>}
            {query ? <small>{entry.path}</small> : null}
            {!entry.directory ? <small>{entry.sizeBytes == null ? '용량 확인 불가' : formatBytes(entry.sizeBytes)}{entry.compressedBytes == null ? '' : ` · 압축 ${formatBytes(entry.compressedBytes)}`}{entry.link ? ' · 심볼릭 링크' : ''}</small> : null}
          </div>
          {entry.encrypted ? <LockKeyhole size={15} aria-label="암호화된 항목" /> : null}
        </div>)}
        {rows.length > limit ? <button type="button" className="button" onClick={() => setLimit(value => value + 200)}>더 보기</button> : null}
      </div>
    </section>
  );
}
