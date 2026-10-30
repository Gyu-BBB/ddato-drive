import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import { config } from '../../core/config.js';
import { fail } from '../../core/errors.js';
import { enforceRateLimit, ipKey } from '../../core/rateLimit.js';
import { settingsRepository } from '../settings/SettingsRepository.js';
import { sshCredentials } from './SshCredentials.js';
import { DriveSftpSession, cleanupSshTemps } from './DriveSftpSession.js';
import { finishSftpChannel } from './SftpChannelLifecycle.js';

const { Server, utils } = ssh2;
export class DriveSshServer {
  constructor({ host = '0.0.0.0' } = {}) { this.host = host; this.clients = new Set(); this.sessions = new Set(); this.server = null; this.error = ''; }
  status() { return { enabled: Boolean(this.server), port: this.port || 2222, host: this.host, fingerprint: this.fingerprint || '', error: this.error }; }
  async initialize() {
    sshCredentials.initialize();
    await cleanupSshTemps().catch(() => { console.warn('SSH 임시 파일 정리를 완료하지 못했습니다.'); });
    this.cleanupTimer = setInterval(() => { void cleanupSshTemps().catch(() => {}); }, 60 * 60 * 1000); this.cleanupTimer.unref();
    if (settingsRepository.get('ssh_enabled')?.value === '1') {
      try { await this.start(Number(settingsRepository.get('ssh_port')?.value) || 2222); }
      catch { this.error = 'SSH 전송 포트를 열지 못했습니다. 포트 사용 여부를 확인해 주세요.'; }
    }
  }
  async configure({ enabled, port = 2222 }) {
    if (typeof enabled !== 'boolean' || !Number.isInteger(port) || port < 1024 || port > 65535 || port === config.port) fail(400, '1024~65535 사이의 다른 포트를 선택해 주세요.');
    const task = (this.configuration || Promise.resolve()).catch(() => {}).then(() => this.applyConfiguration(enabled, port));
    this.configuration = task; return task;
  }
  async applyConfiguration(enabled, port) {
    await this.stop();
    settingsRepository.set('ssh_enabled', 0);
    if (enabled) {
      try { await this.start(port); }
      catch { fail(400, 'SSH 전송 포트를 열지 못했습니다. 다른 포트를 선택해 주세요.'); }
    }
    settingsRepository.set('ssh_port', port); settingsRepository.set('ssh_enabled', enabled ? 1 : 0);
    return this.status();
  }
  async start(port) {
    if (this.server) return;
    const keyPath = path.join(config.appDataDir, 'ssh-host-ed25519');
    if (!fs.existsSync(keyPath)) {
      const key = utils.generateKeyPairSync('ed25519');
      try { fs.writeFileSync(keyPath, key.private, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    fs.chmodSync(keyPath, 0o600);
    const privateKey = fs.readFileSync(keyPath);
    const parsed = utils.parseKey(privateKey); if (parsed instanceof Error) throw parsed;
    this.fingerprint = `SHA256:${crypto.createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
    const server = new Server({ hostKeys: [privateKey], ident: 'DDATO-Drive', readyTimeout: 15000 }, (client, info) => {
      if (this.clients.size >= 64) { client.end(); return; }
      this.clients.add(client); let identity; let sessionCount = 0;
      let lastActivity = Date.now();
      const lifetime = setInterval(() => { if (Date.now() - lastActivity > 15 * 60_000) client.end(); }, 60000); lifetime.unref();
      client.on('error', () => {});
      client.on('close', () => { clearInterval(lifetime); this.clients.delete(client); });
      client.on('authentication', context => {
        try {
          if (context.method !== 'password') { context.reject(['password']); return; }
          enforceRateLimit({ socket: { remoteAddress: info.ip }, headers: {} }, { name: 'ssh-auth', key: ipKey, limit: 20, windowMs: 5 * 60 * 1000 });
          if (context.username.length > 80 || context.password.length > 256) { context.reject(); return; }
          identity = sshCredentials.authenticate(context.username, context.password);
          if (identity) { client.ddatoOwnerId = identity.user.id; context.accept(); } else context.reject();
        } catch { context.reject(); }
      });
      client.on('ready', () => {
        client.on('session', (accept, reject) => {
          if (!identity || sessionCount >= 4) { reject(); return; }
          sessionCount++; const session = accept();
          session.on('sftp', acceptSftp => {
            const stream = acceptSftp(); const adapter = new DriveSftpSession(stream, identity, info.ip, () => { lastActivity = Date.now(); }); this.sessions.add(adapter);
            session.on('end', () => { void adapter.shutdown().then(() => finishSftpChannel(stream)).catch(() => stream.end()); });
            stream.once('close', () => { void adapter.shutdown().finally(() => this.sessions.delete(adapter)); });
          });
          session.on('close', () => { sessionCount--; });
          // No exec, shell, forwarding, symlinks or OS filesystem access.
          session.on('exec', (_accept, rejectExec) => rejectExec?.());
          session.on('shell', (_accept, rejectShell) => rejectShell?.());
        });
      });
    });
    server.on('error', () => { this.error = 'SSH 전송 서버 오류'; });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.host, () => { server.removeListener('error', reject); resolve(); });
    });
    this.server = server; this.port = port; this.error = '';
  }
  async stop() {
    for (const client of this.clients) client.end();
    await Promise.all([...this.sessions].map(session => session.shutdown())); this.sessions.clear();
    const server = this.server; this.server = null;
    if (server) await new Promise(resolve => server.close(resolve));
  }
  revokeUser(ownerId) { for (const client of this.clients) if (client.ddatoOwnerId === ownerId) client.end(); }
}
export const driveSshServer = new DriveSshServer();
