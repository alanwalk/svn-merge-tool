export function parseRevisionExpression(input: string): number[] {
  const rawRevisions = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawRevisions.length === 0) {
    throw new Error('No revisions specified. Use -r 1001,1002,1003');
  }

  const revisions: number[] = [];
  for (const raw of rawRevisions) {
    const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from <= 0 || to <= 0) {
        throw new Error(`Invalid revision range "${raw}". Revisions must be positive integers.`);
      }
      if (from > to) {
        throw new Error(`Invalid revision range "${raw}": start must be <= end.`);
      }
      for (let rev = from; rev <= to; rev++) {
        revisions.push(rev);
      }
    } else {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n <= 0) {
        throw new Error(`Invalid revision "${raw}". Use integers or ranges like 1001-1005.`);
      }
      revisions.push(n);
    }
  }

  return revisions;
}

