const KIB = 1024;

/** `512 B`, `35 KB`, `3.36 MB`: sizes for people, not for arithmetic. */
export function formatBytes(bytes: number): string {
  if (bytes < KIB) return `${String(bytes)} B`;
  const mib = bytes / (KIB * KIB);
  if (mib >= 1) return `${mib.toFixed(mib < 10 ? 2 : 1)} MB`;
  return `${(bytes / KIB).toFixed(0)} KB`;
}
