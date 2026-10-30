import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import ipaddr from 'ipaddr.js';
import ssh2 from 'ssh2';
import { fail } from '../../core/errors.js';

export const fingerprintOf = key => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

export async function resolveSshTarget(user, payload) {
  const host = String(payload.host || '').trim(); const port = Number(payload.port || 22);
  if (!host || host.length > 253 || /[\s/@\\\0]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) fail(400, 'SSH 호스트와 포트를 확인해 주세요.');
  const address = net.isIP(host) ? host : (await dns.lookup(host)).address;
  const range = ipaddr.process(address).range();
  if (range !== 'unicast' && !(user.role === 'admin' && payload.allowPrivate === true && ['private', 'loopback', 'uniqueLocal'].includes(range))) {
    fail(403, '내부 네트워크 SSH 연결은 관리자만 명시적으로 허용할 수 있습니다.');
  }
  return { host, address, port, privateTarget: range !== 'unicast' };
}

export async function connectRemote(user, payload, { probe = false } = {}) {
  const target = await resolveSshTarget(user, payload);
  const fingerprint = String(payload.fingerprint || '').trim();
  if (!probe && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) fail(400, '원격 서버의 SHA256 호스트 키 지문을 확인해 주세요.');
  if (!probe && (!payload.username || String(payload.username).length > 128 || (!payload.password && !payload.privateKey))) fail(400, 'SSH 사용자와 인증 정보를 입력해 주세요.');
  if (String(payload.privateKey || '').length > 32768 || String(payload.password || '').length > 4096 || String(payload.passphrase || '').length > 4096) fail(400, '인증 정보가 너무 큽니다.');
  const client = new ssh2.Client(); let observed = ''; let matched = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { client.end(); reject(error); } else resolve(result); };
    const timer = setTimeout(() => { client.destroy(); finish(new Error('SSH 연결 시간이 초과되었습니다.')); }, 20000); timer.unref();
    client.on('error', () => {
      if (probe && observed) { finish(null, { ...target, fingerprint: observed }); return; }
      const error = new Error(observed && !matched ? '서버 호스트 키 지문이 다릅니다. 연결을 중단했습니다.' : 'SSH 연결 또는 인증에 실패했습니다.'); error.statusCode = 400; finish(error);
    });
    client.on('close', () => { if (!settled) finish(Object.assign(new Error('SSH 연결이 종료되었습니다.'), { statusCode: 400 })); });
    client.on('ready', () => client.sftp((error, sftp) => {
      if (error) { finish(Object.assign(new Error('원격 서버가 SFTP를 지원하지 않습니다.'), { statusCode: 400 })); return; }
      finish(null, { client, sftp, ...target, fingerprint });
    }));
    try {
      client.connect({ host: target.address, port: target.port, username: probe ? 'host-key-probe' : String(payload.username),
        password: probe ? undefined : payload.password || undefined, privateKey: probe ? undefined : payload.privateKey || undefined,
        passphrase: probe ? undefined : payload.passphrase || undefined, readyTimeout: 15000, keepaliveInterval: 15000, keepaliveCountMax: 2,
        hostVerifier(key) {
          observed = fingerprintOf(key); matched = observed === fingerprint;
          if (probe) { queueMicrotask(() => { finish(null, { ...target, fingerprint: observed }); client.end(); }); return false; }
          return matched;
        }
      });
    } catch { finish(Object.assign(new Error('SSH 인증 정보 형식을 확인해 주세요.'), { statusCode: 400 })); }
  });
}
