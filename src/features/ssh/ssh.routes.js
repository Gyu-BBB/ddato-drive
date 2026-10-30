import express from 'express';
import { asyncRoute, jsonError } from '../../core/http.js';
import { requireUser, requireAdmin } from '../auth/auth.middleware.js';
import { enforceRateLimit, ipKey } from '../../core/rateLimit.js';
import { auditLogger } from '../audit/AuditLogger.js';
import { driveSshServer } from './DriveSshServer.js';
import { sshCredentials } from './SshCredentials.js';
import { remoteTransferService } from './RemoteTransferService.js';

export const sshRouter = express.Router();
sshRouter.use('/ssh', requireUser);
sshRouter.use('/ssh', (req, res, next) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!['GET', 'HEAD'].includes(req.method) && !req.secure && !local) {
    jsonError(res, 403, 'SSH 인증 정보와 전송 관리는 HTTPS 또는 로컬 연결에서만 가능합니다.'); return;
  }
  res.setHeader('Cache-Control', 'no-store'); next();
});
const rate = req => enforceRateLimit(req, { name: 'ssh-control', key: ipKey, limit: 30, windowMs: 60000 });
sshRouter.get('/ssh/status', asyncRoute((req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, server: driveSshServer.status(), credential: sshCredentials.info(req.user.id) }); }));
sshRouter.patch('/ssh/server', requireAdmin, asyncRoute(async (req, res) => {
  rate(req); const server = await driveSshServer.configure(req.body || {}); auditLogger.record('ssh.server.configure', req, null, server); res.json({ ok: true, server });
}));
sshRouter.post('/ssh/credentials', asyncRoute((req, res) => { rate(req); res.setHeader('Cache-Control', 'no-store'); const credential = sshCredentials.rotate(req.user.id); driveSshServer.revokeUser(req.user.id); auditLogger.record('ssh.credential.rotate', req); res.json({ ok: true, credential }); }));
sshRouter.delete('/ssh/credentials', asyncRoute((req, res) => { sshCredentials.revoke(req.user.id); driveSshServer.revokeUser(req.user.id); auditLogger.record('ssh.credential.revoke', req); res.json({ ok: true }); }));
sshRouter.post('/ssh/remote/probe', asyncRoute(async (req, res) => { rate(req); res.json({ ok: true, target: await remoteTransferService.connect(req, req.body || {}, true) }); }));
sshRouter.post('/ssh/remote/connections', asyncRoute(async (req, res) => { rate(req); res.json({ ok: true, connection: await remoteTransferService.connect(req, req.body || {}) }); }));
sshRouter.get('/ssh/remote', asyncRoute((req, res) => res.json({ ok: true, ...remoteTransferService.list(req) })));
sshRouter.get('/ssh/remote/:id/files', asyncRoute(async (req, res) => res.json({ ok: true, ...await remoteTransferService.listDirectory(req, req.params.id, req.query.path || '.') })));
sshRouter.delete('/ssh/remote/:id', asyncRoute((req, res) => { remoteTransferService.disconnect(req, req.params.id); res.json({ ok: true }); }));
sshRouter.post('/ssh/remote/transfers', asyncRoute((req, res) => { rate(req); res.status(202).json({ ok: true, job: remoteTransferService.start(req, req.body || {}) }); }));
sshRouter.delete('/ssh/remote/transfers/:id', asyncRoute((req, res) => res.json({ ok: true, job: remoteTransferService.cancel(req, req.params.id) })));
