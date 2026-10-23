import assert from 'node:assert/strict';
import { adminPath, appPage, drivePath, normalizePathname } from '../src/client/app/appRoutes.js';

for (const [path, page] of [['/', 'drive'], ['/folders/abc', 'drive'], ['/media', 'media'],
  ['/notes/', 'notes'], ['/trash', 'trash'], ['/admin', 'admin'], ['/admin/users', 'admin'],
  ['/admin/files', 'admin'], ['/admin/audit', 'admin'], ['/admin/system', 'admin']]) {
  assert.equal(appPage(path), page);
}
for (const path of ['/admin/login', '/admin-login', '/admin/unknown', '/share/token', '/unknown', '/folders/a/b']) {
  assert.equal(appPage(path), null);
}
assert.equal(normalizePathname('///'), '/');
assert.equal(drivePath(), '/');
assert.equal(drivePath('한글 / folder'), '/folders/%ED%95%9C%EA%B8%80%20%2F%20folder');
assert.equal(adminPath(), '/admin');
assert.equal(adminPath('users'), '/admin/users');
console.log('Navigation paths passed: app pages, nested folders, admin tabs, aliases, invalid routes and encoded folder IDs.');
