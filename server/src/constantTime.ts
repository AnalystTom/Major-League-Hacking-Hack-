const encoder = new TextEncoder();

export function constantTimeEqual(actual: string, expected: string): boolean {
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}
