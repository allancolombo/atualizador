export function compareVersions(a, b) {
  const normalize = (value) => String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => /^\d+$/.test(part) ? Number(part) : part.toLowerCase());
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1;
    return String(x).localeCompare(String(y), 'en', { numeric: true });
  }
  return 0;
}

export function findUpdateRelease(releases, currentVersion) {
  const available = [...(releases || [])].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  const current = String(currentVersion || '').trim();
  const currentRelease = available.find(release => String(release.version || '').trim() === current);
  if (!available.length) return null;
  if (!currentRelease) return available[0];
  return available.find(release => Number(release.id || 0) > Number(currentRelease.id || 0)) || null;
}
