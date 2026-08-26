import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { buildUpdatePackageFromZip, getReleasePolicy, normalizeFutureDeadline } from '../src/release.js';

const now = Date.parse('2026-08-24T12:00:00.000Z');

test('keeps an optional release optional before its deadline', () => {
  assert.deepEqual(getReleasePolicy({ mandatory: 0, deadline_at: '2026-08-25T12:00:00.000Z' }, now), {
    mandatory: false, mandatoryReason: null, deadlineExpired: false
  });
});

test('makes an optional release mandatory after its deadline', () => {
  assert.deepEqual(getReleasePolicy({ mandatory: 0, deadline_at: '2026-08-23T12:00:00.000Z' }, now), {
    mandatory: true, mandatoryReason: 'deadline', deadlineExpired: true
  });
});

test('keeps a configured mandatory release mandatory before its deadline', () => {
  assert.equal(getReleasePolicy({ mandatory: 1, deadline_at: '2026-08-25T12:00:00.000Z' }, now).mandatoryReason, 'configured');
});

test('requires a valid future deadline', () => {
  assert.equal(normalizeFutureDeadline('2026-08-25T12:00:00.000Z', now), '2026-08-25T12:00:00.000Z');
  assert.throws(() => normalizeFutureDeadline('', now), /deadline_required/);
  assert.throws(() => normalizeFutureDeadline('2026-08-23T12:00:00.000Z', now), /deadline_must_be_future/);
});

test('builds final package with root manifest and nginx html destinations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-atualizacao-package-'));
  const source = path.join(directory, 'build.zip');
  const final = path.join(directory, 'final.zip');
  const zip = new AdmZip();
  zip.addFile('dist/index.html', Buffer.from('<html></html>'));
  zip.addFile('dist/static/js/main.js', Buffer.from('console.log("ok");'));
  zip.writeZip(source);

  try {
    const manifest = buildUpdatePackageFromZip(source, final, { product: 'pdv', channel: 'test', version: '1.2.3', releaseId: 42 });
    const output = new AdmZip(final);
    const names = output.getEntries().map(entry => entry.entryName).sort();
    const savedManifest = JSON.parse(output.readAsText('manifest.json'));

    assert.equal(manifest.releaseId, '42');
    assert.deepEqual(names, ['manifest.json', 'nginx/html/index.html', 'nginx/html/static/js/main.js']);
    assert.equal(savedManifest.files.length, 2);
    assert.equal(savedManifest.files[0].destination, 'nginx/html/index.html');
    assert.match(savedManifest.files[0].sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
