import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import ssh2 from 'ssh2';
import { chromium } from 'playwright';
import { acquireSshTransfer } from '../src/features/ssh/SshTransferAdmission.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-ssh-test-'));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const port = await freePort(); const sshPort = await freePort(); const base = `http://127.0.0.1:${port}`;
const backend = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { env: { ...process.env,
  DDATO_DRIVE_DATA_DIR: root, DDATO_DRIVE_DB_FILE: path.join(root, 'drive.sqlite'), DDATO_DRIVE_HOST: '127.0.0.1', DDATO_DRIVE_PORT: String(port),
  DDATO_DRIVE_ADMIN_PASSWORD: '123456', DDATO_DRIVE_GOOGLE_CLIENT_ID: '', DDATO_DRIVE_GOOGLE_CLIENT_SECRET: '', DDATO_DRIVE_TRUST_PROXY: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; backend.stdout.on('data', b => { logs += b; }); backend.stderr.on('data', b => { logs += b; });
let browser; const clients = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const call = (sftp, method, ...args) => new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function command(program, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 30000); timer.unref();
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; }); child.once('error', reject);
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${program} failed ${code}/${signal}: ${err.split('\n').slice(-18).join('\n')}`)); });
  });
}
async function connect(username, password, fingerprint) {
  const client = new ssh2.Client(); clients.push(client);
  return new Promise((resolve, reject) => {
    client.once('error', reject); client.once('ready', () => client.sftp((error, sftp) => error ? reject(error) : resolve({ client, sftp })));
    client.connect({ host: '127.0.0.1', port: sshPort, username, password, readyTimeout: 5000,
      hostVerifier: key => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` === fingerprint });
  });
}
try {
  const slots = Array.from({ length: 10 }, () => acquireSshTransfer('first'));
  assert.throws(() => acquireSshTransfer('first'));
  slots.push(...Array.from({ length: 10 }, () => acquireSshTransfer('second')));
  assert.throws(() => acquireSshTransfer('third'));
  slots.forEach(release => { release(); release(); });
  acquireSshTransfer('first')();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await wait(50); }
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext(); const api = context.request; const headers = { Origin: base };
  async function request(url, data, method = 'POST', requester = api) { const r = await requester.fetch(`${base}${url}`, { method, headers, ...(data ? { data } : {}) }); return { response: r, json: await r.json() }; }
  assert((await request('/api/auth/login', { id: 'admin', password: '123456' })).response.ok());
  await request('/api/admin/users', { id: 'ssh-user', password: 'test-only', quotaBytes: 32 * 1024 * 1024 });
  const userContext = await browser.newContext(); const userApi = userContext.request;
  assert((await request('/api/auth/login', { id: 'ssh-user', password: 'test-only' }, 'POST', userApi)).response.ok());
  const enabled = await request('/api/ssh/server', { enabled: true, port: sshPort }, 'PATCH'); assert(enabled.response.ok(), JSON.stringify(enabled.json)); assert(enabled.json.server.enabled);
  const fingerprint = enabled.json.server.fingerprint;
  const credential = (await request('/api/ssh/credentials', {}, 'POST', userApi)).json.credential;
  assert(credential.password); assert.equal((await (await userApi.get(`${base}/api/ssh/status`)).json()).credential.password, undefined);
  const { sftp } = await connect('ssh-user', credential.password, fingerprint);
  await call(sftp, 'mkdir', '/폴더');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 82);
  await call(sftp, 'writeFile', '/폴더/원본.bin', bytes);
  assert.equal(hash(await call(sftp, 'readFile', '/폴더/원본.bin')), hash(bytes));
  const listed = await (await userApi.get(`${base}/api/files`)).json(); const folder = listed.files.find(f => f.name === '폴더'); assert(folder);
  const file = (await (await userApi.get(`${base}/api/files?parentId=${folder.id}`)).json()).files[0];
  assert.equal(hash(await (await userApi.get(`${base}/api/files/${file.id}/download`)).body()), hash(bytes));
  await assert.rejects(call(sftp, 'readFile', '/../../etc/passwd'));
  await assert.rejects(new Promise((resolve, reject) => clients[0].exec('cat /etc/passwd', error => error ? reject(error) : resolve())));
  await request(`/api/files/${file.id}/password`, { password: 'second-password' }, 'PUT', userApi);
  await assert.rejects(call(sftp, 'readFile', '/폴더/원본.bin'));
  await assert.rejects(call(sftp, 'writeFile', '/폴더/원본.bin', Buffer.from('replacement')));
  await request(`/api/files/${file.id}/password`, { password: 'second-password' }, 'DELETE', userApi);
  await request('/api/admin/users/ssh-user/quota', { quotaBytes: bytes.length + 32 }, 'PATCH');
  await assert.rejects(call(sftp, 'writeFile', '/too-big.bin', Buffer.alloc(65536)));
  assert(!(await (await userApi.get(`${base}/api/files`)).json()).files.some(f => f.name === 'too-big.bin'));
  await request('/api/admin/users/ssh-user/quota', { quotaBytes: 32 * 1024 * 1024 }, 'PATCH');
  console.log('SFTP: Unicode, directory upload/download, byte equality, virtual-root isolation, no shell, locks and quota failures passed.');

  // Real OpenSSH scp (SFTP mode), not merely an ssh2 client simulation.
  const knownHosts = path.join(root, 'known_hosts');
  const scanned = await command('/usr/bin/ssh-keyscan', ['-p', String(sshPort), '-t', 'ed25519', '127.0.0.1']);
  const keyLine = scanned.split('\n').find(line => !line.startsWith('#') && line.includes(' ssh-ed25519 ')); assert(keyLine, scanned);
  const key = Buffer.from(keyLine.trim().split(/\s+/)[2], 'base64'); assert.equal(`SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`, fingerprint);
  fs.writeFileSync(knownHosts, scanned); const input = path.join(root, 'input.bin'); fs.writeFileSync(input, bytes);
  const askpass = path.resolve('scripts/ssh-test-askpass.sh'); fs.chmodSync(askpass, 0o700);
  const env = { SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':99', DDATO_TEST_SSH_PASSWORD: credential.password };
  const options = ['-F', '/dev/null', '-P', String(sshPort), '-o', 'IdentityFile=none', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`];
  await command('/usr/bin/scp', [...options, input, 'ssh-user@127.0.0.1:/scp.bin'], env);
  const output = path.join(root, 'output.bin'); await command('/usr/bin/scp', [...options, 'ssh-user@127.0.0.1:/scp.bin', output], env);
  assert.equal(hash(fs.readFileSync(output)), hash(bytes));
  const tree = path.join(root, 'scp-tree'); fs.mkdirSync(path.join(tree, 'nested'), { recursive: true }); fs.writeFileSync(path.join(tree, 'nested/한글.bin'), bytes);
  await command('/usr/bin/scp', [...options, '-r', tree, 'ssh-user@127.0.0.1:/'], env);
  await command('/usr/bin/scp', [...options, '-r', 'ssh-user@127.0.0.1:/scp-tree', path.join(root, 'download-tree')], env);
  assert.equal(hash(fs.readFileSync(path.join(root, 'download-tree/nested/한글.bin'))), hash(bytes));
  const usage = (await (await userApi.get(`${base}/api/files`)).json()).usageBytes;
  await request('/api/admin/users/ssh-user/quota', { quotaBytes: usage + 32 }, 'PATCH');
  await assert.rejects(call(sftp, 'writeFile', '/scp.bin', Buffer.alloc(65536)));
  assert.equal(hash(await call(sftp, 'readFile', '/scp.bin')), hash(bytes), 'failed overwrite must preserve the original');
  await request('/api/admin/users/ssh-user/quota', { quotaBytes: 32 * 1024 * 1024 }, 'PATCH');
  console.log('Real scp CLI: upload and download passed with pinned host key and exact SHA-256.');

  const payload = { host: '127.0.0.1', port: sshPort, username: 'ssh-user', password: credential.password, fingerprint, allowPrivate: true };
  assert.equal((await request('/api/ssh/remote/probe', { host: '127.0.0.1', port: sshPort, allowPrivate: true })).json.target.fingerprint, fingerprint);
  assert.equal((await request('/api/ssh/remote/connections', { ...payload, fingerprint: `SHA256:${'A'.repeat(43)}` })).response.status(), 400);
  assert.equal((await request('/api/ssh/remote/connections', payload, 'POST', userApi)).response.status(), 403, 'non-admin cannot target loopback');
  const connection = (await request('/api/ssh/remote/connections', payload)).json.connection; assert(connection);
  assert.equal((await userApi.get(`${base}/api/ssh/remote/${connection.id}/files`)).status(), 404);
  assert((await (await api.get(`${base}/api/ssh/remote/${connection.id}/files`)).json()).entries.some(entry => entry.name === 'scp.bin'));
  async function finishJob(id) {
    for (let i = 0; i < 1000; i++) { const job = (await (await api.get(`${base}/api/ssh/remote`)).json()).jobs.find(job => job.id === id); if (job.status !== 'running') return job; await wait(30); }
    throw new Error('SSH job timeout');
  }
  const imported = await request('/api/ssh/remote/transfers', { connectionId: connection.id, direction: 'import', path: '/scp.bin' });
  const importJob = await finishJob(imported.json.job.id); assert.equal(importJob.status, 'done', JSON.stringify(importJob));
  assert.equal(hash(await (await api.get(`${base}/api/files/${importJob.fileId}/download`)).body()), hash(bytes));
  const exported = await request('/api/ssh/remote/transfers', { connectionId: connection.id, direction: 'export', path: '/exported.bin', fileId: importJob.fileId });
  const exportJob = await finishJob(exported.json.job.id); assert.equal(exportJob.status, 'done', JSON.stringify(exportJob));
  assert.equal(hash(await call(sftp, 'readFile', '/exported.bin')), hash(bytes));
  const exists = await request('/api/ssh/remote/transfers', { connectionId: connection.id, direction: 'export', path: '/exported.bin', fileId: importJob.fileId });
  assert.equal((await finishJob(exists.json.job.id)).status, 'failed');
  await call(sftp, 'writeFile', '/cancel-source.bin', Buffer.alloc(8 * 1024 * 1024, 64));
  const canceled = await request('/api/ssh/remote/transfers', { connectionId: connection.id, direction: 'import', path: '/cancel-source.bin' });
  assert((await request(`/api/ssh/remote/transfers/${canceled.json.job.id}`, null, 'DELETE')).response.ok());
  assert.equal((await finishJob(canceled.json.job.id)).status, 'canceled');
  assert(!(await (await api.get(`${base}/api/files`)).json()).files.some(file => file.name === 'cancel-source.bin'));
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync('.tmp', { recursive: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 }); await page.goto(`${base}/ssh`);
    await page.getByRole('heading', { name: 'SCP / SFTP 접속' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('tab', { name: '원격 서버', exact: true }).click();
    await page.getByRole('button', { name: '연결', exact: true }).waitFor();
    await page.locator(`select[aria-label="원격 연결"] option[value="${connection.id}"]`).waitFor({ state: 'attached' });
    await page.getByRole('heading', { name: '전송 작업' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `.tmp/ssh-transfer-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  const localPane = page.locator('.ssh-panes > section').first();
  const remotePane = page.locator('.ssh-panes > section').last();
  const sendEvent = page.waitForResponse(response => response.url().endsWith('/api/ssh/remote/transfers') && response.status() === 202);
  page.once('dialog', dialog => dialog.accept('/from-web.bin'));
  await localPane.locator('.ssh-file-row').filter({ has: page.getByText('scp.bin', { exact: true }) }).getByRole('button', { name: '원격으로 보내기' }).click();
  const sent = (await (await sendEvent).json()).job; assert.equal((await finishJob(sent.id)).status, 'done');
  const receiveEvent = page.waitForResponse(response => response.url().endsWith('/api/ssh/remote/transfers') && response.status() === 202);
  await remotePane.locator('.ssh-file-row').filter({ has: page.getByText('exported.bin', { exact: true }) }).getByRole('button', { name: '드라이브로 가져오기' }).click();
  const received = (await (await receiveEvent).json()).job; const receivedJob = await finishJob(received.id); assert.equal(receivedJob.status, 'done');
  assert.equal(hash(await (await api.get(`${base}/api/files/${receivedJob.fileId}/download`)).body()), hash(bytes));
  const closed = new Promise(resolve => clients[0].once('close', resolve));
  await request('/api/ssh/credentials', null, 'DELETE', userApi);
  await Promise.race([closed, wait(5000).then(() => { throw new Error('Revoked SSH client did not disconnect'); })]);
  await assert.rejects(connect('ssh-user', credential.password, fingerprint));
  assert(!logs.includes(credential.password));
  const audit = JSON.stringify((await (await api.get(`${base}/api/admin/audit`)).json()).logs);
  assert(!audit.includes(credential.password));
  assert.equal(fs.statSync(path.join(root, 'app-data/ssh-host-ed25519')).mode & 0o777, 0o600);
  console.log('Web SSH: key probe/pinning, SSRF/owner isolation, both transfer directions, no overwrite, credential revocation, secret-free audit and desktop/mobile UI passed.');
  await request('/api/ssh/server', { enabled: false, port: sshPort }, 'PATCH');
} catch (error) { console.error(logs.split('\n').slice(-25).join('\n')); throw error; }
finally {
  for (const client of clients) client.end();
  await browser?.close(); backend.kill('SIGTERM');
  await new Promise(resolve => backend.exitCode !== null ? resolve() : backend.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
