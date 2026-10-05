/**
 * Character error rate: edits needed to turn the transcript into the truth,
 * over the truth's length. Whitespace is collapsed first, because a scan
 * reader that wraps a line differently hasn't misread anything.
 */
export function cer(truth: string, transcript: string): number {
  const a = truth.replace(/\s+/g, " ").trim();
  const b = transcript.replace(/\s+/g, " ").trim();
  if (!a.length) return b.length ? 1 : 0;
  // Two-row Levenshtein: O(len) memory, fine for a few pages of text.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] / a.length;
}
