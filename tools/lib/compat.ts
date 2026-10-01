/**
 * Additive-only compatibility against the last published catalog.
 * Documents in the wild reference types/patterns by id, alias and stepType,
 * and store field values by key + storage — none of that may change.
 * Exception: a type or pattern may be deleted outright; it simply drops out of
 * the next published build (reported as a note, not an error).
 * `version` is informational: content may change without a bump, but a
 * version may never go backwards.
 */
import type { Catalog, CatalogPattern, CatalogType } from './catalog.ts';

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export function checkCompat(
  prev: Pick<Catalog, 'types' | 'patterns'>,
  next: { types: CatalogType[]; patterns: Array<Omit<CatalogPattern, 'sha256'> & { sha256?: string }> },
): string[] {
  const errors: string[] = [];
  const nextTypes = new Map(next.types.map(t => [t.id, t]));

  for (const old of prev.types) {
    const cur = nextTypes.get(old.id);
    if (!cur) continue; // removal is allowed; reported via removedTypes()
    for (const prop of ['bpmnType', 'eventDefinitionType', 'stepType', 'category'] as const) {
      if (old[prop] !== cur[prop]) errors.push(`${old.id}: ${prop} cannot change (${String(old[prop])} → ${String(cur[prop])})`);
    }
    for (const alias of old.aliases ?? []) {
      if (!(cur.aliases ?? []).includes(alias)) errors.push(`${old.id}: alias "${alias}" cannot be removed`);
    }
    const curFields = new Map(cur.form.map(f => [f.key, f]));
    for (const f of old.form) {
      const c = curFields.get(f.key);
      if (!c) {
        errors.push(`${old.id}: form field "${f.key}" cannot be removed`);
        continue;
      }
      if (c.type !== f.type) errors.push(`${old.id}: form field "${f.key}" type cannot change (${f.type} → ${c.type})`);
      if (c.storage !== f.storage) errors.push(`${old.id}: form field "${f.key}" storage cannot change (${f.storage} → ${c.storage}); pin "storage: ${f.storage}" in the YAML`);
    }
    if (compareSemver(cur.version, old.version) < 0) errors.push(`${old.id}: version cannot go backwards (${old.version} → ${cur.version})`);
  }

  const nextPatterns = new Map(next.patterns.map(p => [p.id, p]));
  for (const old of prev.patterns) {
    const cur = nextPatterns.get(old.id);
    if (!cur) continue; // removal is allowed; reported via removedPatterns()
    for (const alias of old.aliases ?? []) {
      if (!(cur.aliases ?? []).includes(alias)) errors.push(`${old.id}: alias "${alias}" cannot be removed`);
    }
    if (compareSemver(cur.version, old.version) < 0) errors.push(`${old.id}: version cannot go backwards (${old.version} → ${cur.version})`);
  }
  return errors;
}

/** Ids of published types that no longer exist (they drop out of the next build). */
export function removedTypes(
  prev: Pick<Catalog, 'types'>,
  next: { types: Array<Pick<CatalogType, 'id'>> },
): string[] {
  const ids = new Set(next.types.map(t => t.id));
  return prev.types.filter(t => !ids.has(t.id)).map(t => t.id);
}

/** Ids of published patterns that no longer exist (they drop out of the next build). */
export function removedPatterns(
  prev: Pick<Catalog, 'patterns'>,
  next: { patterns: Array<Pick<CatalogPattern, 'id'>> },
): string[] {
  const ids = new Set(next.patterns.map(p => p.id));
  return prev.patterns.filter(p => !ids.has(p.id)).map(p => p.id);
}

/**
 * Removed ids that a new type lists in `aliases` — a rename (file moved).
 * Documents that stored the old id keep resolving through the alias.
 */
export function renamedTypes(
  prev: Pick<Catalog, 'types'>,
  next: { types: Array<Pick<CatalogType, 'id' | 'aliases'>> },
): Array<{ from: string; to: string }> {
  const byAlias = new Map<string, string>();
  for (const t of next.types) for (const a of t.aliases ?? []) byAlias.set(a, t.id);
  return removedTypes(prev, next)
    .filter(id => byAlias.has(id))
    .map(id => ({ from: id, to: byAlias.get(id)! }));
}

export type PublishedLookup =
  | { status: 'found'; catalog: Catalog }
  | { status: 'none'; reason: string };

/** Fetch the published catalog. A missing endpoint means "first publish". */
export async function fetchPublished(url: string): Promise<PublishedLookup> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return { status: 'none', reason: `${url} returned 404` };
  const ct = res.headers.get('content-type') ?? '';
  if (res.ok && !ct.includes('application/json')) {
    return { status: 'none', reason: `${url} is not serving a catalog yet (content-type ${ct})` };
  }
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return { status: 'found', catalog: (await res.json()) as Catalog };
}
