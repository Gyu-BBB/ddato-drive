import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { archivePreviewService } from '../src/features/files/ArchivePreviewService.js';
import { isArchiveName } from '../src/shared/archiveFormats.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddato-archive-preview-'));
const tarTool = fs.existsSync('/opt/homebrew/opt/libarchive/bin/bsdtar') ? '/opt/homebrew/opt/libarchive/bin/bsdtar' : 'bsdtar';
try {
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, '한글 폴더'), { recursive: true });
  fs.writeFileSync(path.join(source, '한글 폴더', 'hello.txt'), 'hello archive');
  fs.writeFileSync(path.join(source, 'line\nbreak.txt'), 'newline filename');
  fs.symlinkSync('한글 폴더/hello.txt', path.join(source, 'shortcut'));
  const formats = [
    ['fixture.tar', []], ['fixture.tar.gz', ['-z']], ['fixture.tgz', ['-z']],
    ['fixture.tar.bz2', ['-j']], ['fixture.tbz2', ['-j']], ['fixture.tar.xz', ['-J']],
    ['fixture.txz', ['-J']], ['fixture.7z', ['--format', '7zip']],
    ['fixture.cpio', ['--format', 'cpio']], ['fixture.tar.zst', ['--zstd']], ['fixture.tar.lz4', ['--lz4']]
  ];
  for (const [name, flags] of formats) {
    const archive = path.join(root, name);
    execFileSync(tarTool, ['-cf', archive, ...flags, '-C', source, '.']);
    const preview = await archivePreviewService.inspect(archive, name);
    assert.equal(preview.kind, 'archive');
    assert(preview.entries.some(entry => entry.path === '한글 폴더/hello.txt' && entry.sizeBytes === 13), name);
    assert(preview.entries.some(entry => entry.path === 'line\nbreak.txt'), 'listing must preserve newline in filenames');
    assert(preview.entries.some(entry => entry.path === 'shortcut' && entry.link), 'symbolic links must only be listed');
    console.log(`${name}: ${preview.entries.length} entries, nested names and sizes passed.`);
  }
  const single = path.join(root, 'single.txt.gz');
  const arFile = path.join(root, 'fixture.ar');
  fs.writeFileSync(path.join(source, 'member.txt'), 'ar content');
  execFileSync(tarTool, ['--format', 'ar', '-cf', arFile, '-C', source, 'member.txt']);
  const arPreview = await archivePreviewService.inspect(arFile, 'fixture.ar');
  assert(arPreview.entries.some(entry => entry.path === 'member.txt' && entry.sizeBytes === 10));
  fs.writeFileSync(single, gzipSync('single compressed content'));
  const singlePreview = await archivePreviewService.inspect(single, 'single.txt.gz');
  assert.equal(singlePreview.entries[0].path, 'single.txt');
  assert.equal(singlePreview.entries[0].sizeBytes, null);
  const corrupt = path.join(root, 'corrupt.tar');
  fs.writeFileSync(corrupt, 'not an archive');
  await assert.rejects(archivePreviewService.inspect(corrupt, 'corrupt.tar'));
  for (const name of ['x.tar', 'x.tgz', 'x.tar.bz2', 'x.tar.xz', 'x.tar.zst', 'x.7z', 'x.rar', 'x.cpio', 'x.ar', 'x.cab', 'x.iso']) assert(isArchiveName(name));
  for (const name of ['x.docx', 'x.xlsx', 'x.hwpx', 'x.epub']) assert(!isArchiveName(name, 'application/zip'));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Archive format tests passed; files were listed without extraction.');
