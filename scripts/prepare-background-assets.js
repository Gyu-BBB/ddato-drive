import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_ASSET_PATH, BACKGROUND_MODEL_SHA256, BACKGROUND_MODEL_URL } from '../src/client/features/files/backgroundRemoval/config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public', BACKGROUND_ASSET_PATH);
await fs.mkdir(target, { recursive: true });
const modelPath = path.join(target, 'u2netp.onnx');
const hash = data => createHash('sha256').update(data).digest('hex');
let model = await fs.readFile(modelPath).catch(() => null);
if (!model || hash(model) !== BACKGROUND_MODEL_SHA256) {
  console.log('Downloading the background-removal model (4.4 MB)...');
  const response = await fetch(BACKGROUND_MODEL_URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  model = Buffer.from(await response.arrayBuffer());
  if (hash(model) !== BACKGROUND_MODEL_SHA256) throw new Error('Background model checksum mismatch');
  await fs.writeFile(`${modelPath}.part`, model);
  await fs.rename(`${modelPath}.part`, modelPath);
}
const runtimeRoot = path.join(root, 'node_modules', 'onnxruntime-web');
const runtime = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'package.json'), 'utf8'));
if (runtime.version !== '1.21.0') throw new Error('Background-removal assets require onnxruntime-web 1.21.0');
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await fs.copyFile(path.join(runtimeRoot, 'dist', name), path.join(target, name));
}
for (const [name, url] of [
  ['U2NET-LICENSE.txt', 'https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE'],
  ['ONNXRUNTIME-LICENSE.txt', 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.21.0/LICENSE']
]) {
  if (await fs.stat(path.join(target, name)).catch(() => false)) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`License download failed: ${name}`);
  await fs.writeFile(path.join(target, name), await response.text());
}
await fs.copyFile(path.join(root, 'docs', 'background-removal-notices.txt'), path.join(target, 'NOTICE.txt'));
console.log('Background-removal model, runtime and licenses are ready (same-origin, browser-only inference).');
