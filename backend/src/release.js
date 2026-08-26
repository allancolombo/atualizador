import crypto from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';

export function getReleasePolicy(release, now = Date.now()) {
  const deadlineTime = release?.deadline_at ? Date.parse(release.deadline_at) : NaN;
  const deadlineExpired = Number.isFinite(deadlineTime) && now >= deadlineTime;
  const configuredMandatory = Boolean(release?.mandatory);
  return {
    mandatory: configuredMandatory || deadlineExpired,
    mandatoryReason: configuredMandatory ? 'configured' : deadlineExpired ? 'deadline' : null,
    deadlineExpired
  };
}

export function normalizeFutureDeadline(value, now = Date.now()) {
  if (!value) throw new Error('deadline_required');
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) throw new Error('deadline_required');
  if (deadline.getTime() <= now) throw new Error('deadline_must_be_future');
  return deadline.toISOString();
}

function normalizedZipPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) throw new Error('invalid_zip_path');
  return normalized;
}

function stripCommonRoot(paths) {
  if (!paths.length) return paths;
  const first = paths[0].split('/')[0];
  if (!first || paths.some(item => !item.startsWith(`${first}/`))) return paths;
  return paths.map(item => item.slice(first.length + 1)).filter(Boolean);
}

export function buildUpdatePackageFromZip(sourceZipPath, finalZipPath, { product, channel, version, releaseId, destinationRoot = 'nginx/html' }) {
  const input = new AdmZip(sourceZipPath);
  const entries = input.getEntries()
    .filter(entry => !entry.isDirectory)
    .map(entry => ({ entry, source: normalizedZipPath(entry.entryName) }))
    .filter(item => path.basename(item.source).toLowerCase() !== 'manifest.json');
  if (!entries.length) throw new Error('empty_package');

  const stripped = stripCommonRoot(entries.map(item => item.source));
  const output = new AdmZip();
  const files = entries.map((item, index) => {
    const relative = normalizedZipPath(stripped[index]);
    const data = item.entry.getData();
    const destination = `${destinationRoot}/${relative}`;
    output.addFile(destination, data);
    return {
      source: item.source,
      destination,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.length
    };
  }).sort((a, b) => a.destination.localeCompare(b.destination));

  const manifest = {
    schemaVersion: 1,
    product,
    channel,
    version,
    releaseId: String(releaseId),
    generatedAt: new Date().toISOString(),
    files
  };
  output.addFile('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  output.writeZip(finalZipPath);
  return manifest;
}
