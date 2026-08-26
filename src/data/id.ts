// Lightweight unique-id generator. Not cryptographically secure, but this
// app never has more than a few hundred records, so collisions are a
// non-issue and we avoid pulling in an extra dependency.
export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
