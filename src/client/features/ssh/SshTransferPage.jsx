import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Copy, Eye, EyeOff, Folder, KeyRound, Plug, RefreshCcw, Server, ShieldCheck, Unplug, X } from 'lucide-react';
import { Button } from '../../shared/components/Button.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { filesApi } from '../files/filesApi.js';
import { formatBytes } from '../../shared/lib/formatBytes.js';
import { formatPercent } from '../../shared/lib/formatPercent.js';
import { formatDate } from '../../shared/lib/dates.js';
import { sshApi } from './sshApi.js';
import '../../shared/components/management.css';
import './sshTransfer.css';

export function SshTransferPage() {
  const [tab, setTab] = useState('access');
  return <section className="management-page">
    <header className="management-header"><h1>SSH 전송</h1><div className="ssh-tabs" role="tablist" aria-label="SSH 전송 방식">
      <button role="tab" aria-selected={tab === 'access'} onClick={() => setTab('access')}>드라이브 접속</button>
      <button role="tab" aria-selected={tab === 'remote'} onClick={() => setTab('remote')}>원격 서버</button>
    </div></header>
    <div className="management-scroll">{tab === 'access' ? <SshAccess /> : <RemoteFiles />}</div>
  </section>;
}
function SshAccess() {
  const { user } = useAuth(); const [data, setData] = useState(null); const [port, setPort] = useState('2222');
  const [secret, setSecret] = useState(''); const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function load() { const result = await sshApi.status(); setData(result); setPort(String(result.server.port)); }
  useEffect(() => { void load().catch(error => setError(error.message)); }, []);
  async function run(action) { setBusy(true); setError(''); try { await action(); await load(); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  async function copy(value) { try { await navigator.clipboard.writeText(value); } catch { setError('복사하지 못했습니다.'); } }
  const host = window.location.hostname;
  const shellTarget = `'${`${user.id}@${host}`.replace(/'/g, `'\\''`)}'`;
  const command = `sftp -P ${data?.server.port || 2222} ${shellTarget}`;
  return <section className="ssh-access">
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
    <div className="ssh-section-header"><Server size={18} /><h2>SCP / SFTP 접속</h2><span>{data?.server.enabled ? '서버 실행 중' : '서버 꺼짐'}</span></div>
    {user.role === 'admin' ? <div className="ssh-inline"><label className="field"><span>SSH 포트</span><input type="number" min="1024" max="65535" value={port} onChange={event => setPort(event.target.value)} /></label>
      <Button icon={data?.server.enabled ? Unplug : Plug} disabled={busy} onClick={() => run(async () => {
        if (!data?.server.enabled && !window.confirm('모든 네트워크 인터페이스에 SSH 전송 포트를 열까요? 셸 접속은 허용하지 않습니다.')) return;
        await sshApi.configure({ enabled: !data?.server.enabled, port: Number(port) });
      })}>{data?.server.enabled ? '서버 중지' : '서버 시작'}</Button></div> : null}
    {data?.server.error ? <p role="alert">{data.server.error}</p> : null}
    <dl className="ssh-facts"><div><dt>호스트</dt><dd>{host}</dd></div><div><dt>포트</dt><dd>{data?.server.port || 2222}</dd></div><div><dt>사용자</dt><dd>{user.id}</dd></div><div><dt>호스트 키 지문</dt><dd>{data?.server.fingerprint || '서버 시작 후 표시'}</dd></div><div><dt>인증 만료</dt><dd>{data?.credential ? formatDate(data.credential.expiresAt) : '발급된 인증 없음'}</dd></div></dl>
    <div className="ssh-inline"><Button icon={KeyRound} disabled={busy} onClick={() => run(async () => { const result = await sshApi.credential(); setSecret(result.credential.password); })}>전송 비밀번호 발급·재발급</Button>
      <Button icon={X} disabled={busy || !data?.credential} onClick={() => run(async () => { await sshApi.revoke(); setSecret(''); })}>인증 해제</Button></div>
    {secret ? <div className="ssh-secret"><label className="field"><span>새 전송 비밀번호 · 이번에만 표시</span><input readOnly autoComplete="off" type={visible ? 'text' : 'password'} value={secret} /></label><Button icon={visible ? EyeOff : Eye} iconOnly onClick={() => setVisible(!visible)}>비밀번호 표시 전환</Button><Button icon={Copy} iconOnly onClick={() => copy(secret)}>비밀번호 복사</Button></div> : null}
    <h2>접속 명령</h2><div className="ssh-command"><code>{command}</code><Button icon={Copy} iconOnly onClick={() => copy(command)}>SFTP 명령 복사</Button></div>
    <a href="/ssh-transfer-guide.md" target="_blank" rel="noreferrer">SCP 명령·외부 네트워크 설정</a>
  </section>;
}

const initialForm = { host: '', port: '22', username: '', password: '', privateKey: '', passphrase: '', fingerprint: '', allowPrivate: false };
function RemoteFiles() {
  const { user } = useAuth(); const [form, setForm] = useState(initialForm); const [auth, setAuth] = useState('password');
  const [connections, setConnections] = useState([]); const [connectionId, setConnectionId] = useState(''); const [jobs, setJobs] = useState([]);
  const [remotePath, setRemotePath] = useState('.'); const [remote, setRemote] = useState([]); const [localPath, setLocalPath] = useState([]); const [local, setLocal] = useState([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [observed, setObserved] = useState('');
  const parentId = localPath.at(-1)?.id || null;
  const field = (name, value) => setForm(form => ({ ...form, [name]: value }));
  useEffect(() => {
    let disposed = false; let timer;
    async function poll() {
      try { const result = await sshApi.list(); if (disposed) return; setConnections(result.connections); setJobs(result.jobs); setConnectionId(id => result.connections.some(c => c.id === id) ? id : result.connections[0]?.id || ''); }
      catch (error) { if (!disposed) setError(error.message); }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, []);
  useEffect(() => { let current = true; filesApi.list({ parentId }).then(result => { if (current) setLocal(result.files); }).catch(error => { if (current) setError(error.message); }); return () => { current = false; }; }, [parentId, jobs.filter(job => job.status === 'done').length]);
  useEffect(() => {
    let current = true; setRemote([]);
    if (connectionId) sshApi.files(connectionId, remotePath).then(result => { if (current) { setRemote(result.entries); if (result.truncated) setError('원격 폴더의 최초 1000개 항목만 표시합니다.'); } }).catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [connectionId, remotePath, jobs.filter(job => job.status === 'done').length]);
  async function run(action) { setError(''); setBusy(true); try { await action(); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  const join = (directory, name) => `${directory.replace(/\/$/, '')}/${name}`;
  async function transfer(direction, entry) {
    if (!connectionId) return;
    await run(async () => {
      if (direction === 'export' && entry.passwordProtected && !entry.passwordUnlocked) {
        const password = window.prompt('파일 암호'); if (password === null) return; await filesApi.unlock(entry.id, password);
      }
      const target = direction === 'export' ? window.prompt('원격 대상 파일 경로', join(remotePath, entry.name)) : join(remotePath, entry.name);
      if (!target) return;
      const result = await sshApi.transfer({ connectionId, direction, path: target, fileId: entry.id, parentId }); setJobs(jobs => [...jobs, result.job]);
    });
  }
  return <>
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
    <form className="ssh-connect" onSubmit={event => { event.preventDefault(); void run(async () => {
      const payload = { ...form, port: Number(form.port), password: auth === 'password' ? form.password : '', privateKey: auth === 'key' ? form.privateKey : '' };
      const result = await sshApi.connect(payload); setConnections(connections => [...connections, result.connection]); setConnectionId(result.connection.id); setRemotePath('.');
      setForm(form => ({ ...form, password: '', privateKey: '', passphrase: '' }));
    }); }}>
      <label className="field"><span>호스트</span><input required value={form.host} onChange={event => { field('host', event.target.value); setObserved(''); }} /></label>
      <label className="field"><span>포트</span><input type="number" required min="1" max="65535" value={form.port} onChange={event => field('port', event.target.value)} /></label>
      <label className="field"><span>사용자</span><input required value={form.username} onChange={event => field('username', event.target.value)} autoComplete="off" /></label>
      <label className="field"><span>인증 방식</span><select value={auth} onChange={event => setAuth(event.target.value)}><option value="password">비밀번호</option><option value="key">개인 키</option></select></label>
      {auth === 'password' ? <label className="field"><span>비밀번호</span><input type="password" required value={form.password} onChange={event => field('password', event.target.value)} autoComplete="new-password" /></label> : <><label className="field ssh-key"><span>개인 키</span><textarea required value={form.privateKey} onChange={event => field('privateKey', event.target.value)} /></label><label className="field"><span>키 암호</span><input type="password" value={form.passphrase} onChange={event => field('passphrase', event.target.value)} autoComplete="new-password" /></label></>}
      {user.role === 'admin' ? <label className="ssh-check"><input type="checkbox" checked={form.allowPrivate} onChange={event => field('allowPrivate', event.target.checked)} />내부·로컬 네트워크 연결 허용</label> : null}
      <div className="ssh-key"><Button icon={ShieldCheck} disabled={busy} onClick={() => run(async () => { const result = await sshApi.probe({ ...form, port: Number(form.port), password: '', privateKey: '', passphrase: '' }); setObserved(result.target.fingerprint); })}>호스트 키 조회</Button>{observed ? <output className="ssh-observed">조회 지문: {observed}</output> : null}</div>
      <label className="field ssh-key"><span>별도로 대조한 서버 SHA256 지문</span><input required value={form.fingerprint} onChange={event => field('fingerprint', event.target.value)} placeholder="SHA256:…" /></label>
      <Button icon={Plug} variant="primary" type="submit" disabled={busy}>연결</Button>
    </form>
    <div className="ssh-inline"><select aria-label="원격 연결" value={connectionId} onChange={event => { setConnectionId(event.target.value); setRemotePath('.'); }}><option value="">연결 선택</option>{connections.map(c => <option key={c.id} value={c.id}>{c.host}:{c.port}</option>)}</select><Button icon={Unplug} iconOnly disabled={busy || !connectionId} onClick={() => run(async () => { await sshApi.disconnect(connectionId); setConnections(connections => connections.filter(c => c.id !== connectionId)); setConnectionId(''); })}>연결 종료</Button></div>
    <div className="ssh-panes">
      <section><header><h2>드라이브</h2><Button icon={ArrowLeft} iconOnly disabled={!localPath.length} onClick={() => setLocalPath(path => path.slice(0, -1))}>상위 드라이브 폴더</Button></header><p className="ssh-path">{['홈', ...localPath.map(folder => folder.name)].join(' / ')}</p>
        <div className="ssh-file-list">{local.map(entry => <div key={entry.id} className="ssh-file-row"><button type="button" disabled={entry.type !== 'folder'} onClick={() => run(async () => {
          if (entry.passwordProtected && !entry.passwordUnlocked) { const password = window.prompt('폴더 암호'); if (password === null) return; await filesApi.unlock(entry.id, password); }
          setLocalPath(path => [...path, entry]);
        })}>{entry.type === 'folder' ? <Folder size={16} /> : null}<span>{entry.name}</span></button><small>{entry.type === 'file' ? formatBytes(entry.sizeBytes) : ''}</small><Button icon={ArrowUpFromLine} iconOnly disabled={busy || !connectionId || entry.type !== 'file'} onClick={() => transfer('export', entry)}>원격으로 보내기</Button></div>)}</div>
      </section>
      <section><header><h2>원격 서버</h2><Button icon={ArrowLeft} iconOnly disabled={!connectionId} onClick={() => setRemotePath(path => join(path, '..'))}>상위 원격 폴더</Button></header>
        <form className="ssh-inline" onSubmit={event => { event.preventDefault(); setRemotePath(event.currentTarget.elements.path.value); }}><input name="path" aria-label="원격 폴더 경로" defaultValue={remotePath} key={remotePath} /><Button icon={RefreshCcw} iconOnly disabled={!connectionId} type="submit">원격 경로 열기</Button></form>
        <div className="ssh-file-list">{remote.map(entry => <div key={entry.name} className="ssh-file-row"><button type="button" disabled={entry.type !== 'folder'} onClick={() => setRemotePath(join(remotePath, entry.name))}>{entry.type === 'folder' ? <Folder size={16} /> : null}<span>{entry.name}</span></button><small>{entry.type === 'file' ? formatBytes(entry.sizeBytes) : ''}</small><Button icon={ArrowDownToLine} iconOnly disabled={busy || entry.type !== 'file'} onClick={() => transfer('import', entry)}>드라이브로 가져오기</Button></div>)}</div>
      </section>
    </div>
    <section className="ssh-jobs"><h2>전송 작업</h2>{jobs.slice(-50).reverse().map(job => <div className="ssh-job" key={job.id}><div><strong>{job.direction === 'import' ? '가져오기' : '보내기'} · {job.path}</strong><small>{({ running: '전송 중', done: '완료', failed: '실패', canceled: '취소됨' })[job.status]} · {formatBytes(job.bytes)} / {job.sizeBytes == null ? '크기 확인 중' : formatBytes(job.sizeBytes)} · {job.sizeBytes ? formatPercent(Math.min(job.status === 'done' ? 100 : 99, job.bytes / job.sizeBytes * 100)) : ''}{job.error ? ` · ${job.error}` : ''}</small></div>{job.status === 'running' ? <Button icon={X} iconOnly onClick={() => run(() => sshApi.cancel(job.id))}>SSH 전송 취소</Button> : null}</div>)}</section>
  </>;
}
