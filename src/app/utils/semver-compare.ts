/**
 * Porównanie semver bez zewnętrznych zależności (tylko rdzeń X.Y.Z, opcjonalnie sufiks po „-” jest odrzucany).
 * @returns > 0 gdy a > b, 0 gdy równe, < 0 gdy a < b
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverCore(a);
  const pb = parseSemverCore(b);
  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }
  return pa.patch - pb.patch;
}

function parseSemverCore(v: string): { major: number; minor: number; patch: number } {
  const core = v.split('-')[0].split('+')[0].trim();
  const parts = core.split('.');
  const major = parseInt(parts[0] || '0', 10);
  const minor = parseInt(parts[1] || '0', 10);
  const pm = (parts[2] || '0').match(/^(\d+)/);
  const patch = pm ? parseInt(pm[1], 10) : 0;
  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0
  };
}
