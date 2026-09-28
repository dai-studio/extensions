/**
 * Canonical JSON — MUST stay byte-for-byte identical to
 * ws-dai-studio/editor-src/src/lib/types/TypeDefinition.ts `canonicalJson`.
 *
 * Rules (the editor's verifier depends on every one of them):
 *   - object keys sorted with the default UTF-16 `.sort()` (no locale)
 *   - keys whose value is `undefined` are dropped
 *   - `null` is kept (schema validation rejects nulls, so none reach here)
 *   - arrays keep their order
 *   - scalars use JSON.stringify, no whitespace anywhere
 *
 * The shared vectors in test-vectors/canonical.json are replayed by both
 * repos' test suites.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const o = obj as Record<string, unknown>;
  const sorted = Object.keys(o)
    .sort()
    .filter(k => o[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonicalJson(o[k]));
  return '{' + sorted.join(',') + '}';
}

/** Payload signed for a type or catalog: every field except `signature`. */
export function signablePayload(obj: Record<string, unknown>): string {
  const { signature: _sig, ...rest } = obj;
  return canonicalJson(rest);
}
