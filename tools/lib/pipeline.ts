import { execFileSync } from 'node:child_process';
import { sha256Hex } from './crypto.ts';
import { buildCatalog, type Catalog } from './catalog.ts';
import { checkCompat, fetchPublished, removedPatterns, removedTypes, renamedTypes } from './compat.ts';
import { loadRepo, ROOT, type Repo } from './repo.ts';
import { validatePatterns, validateRepo } from './validate.ts';

export async function patternShas(repo: Repo): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of repo.patterns) out[p.id] = await sha256Hex(p.xml);
  return out;
}

export function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'local';
  }
}

export interface CheckResult {
  /** Published content only (types/ + patterns/) — what build and publish use. */
  repo: Repo;
  catalog: Catalog | null;
  errors: string[];
  notes: string[];
  /** Types in unpublished/ that were validated but left out of the catalog. */
  unpublishedTypes: number;
}

/**
 * Full validation (schema, semantics, patterns and — when `compatUrl` is set —
 * additive-only compatibility against the published catalog).
 *
 * Types in unpublished/ are validated together with types/ (so ids, aliases
 * and stepTypes stay unique across both), but patterns, the catalog and the
 * compat check only see published types.
 */
export async function checkAll(opts: { compatUrl?: string; root?: string } = {}): Promise<CheckResult> {
  const root = opts.root ?? ROOT;
  const full = loadRepo(root, { includeUnpublished: true });
  const repo = loadRepo(root);
  const notes: string[] = [];
  const unpublishedIds = new Set(full.types.filter(t => t.unpublished).map(t => t.id));
  const unpublishedTypes = unpublishedIds.size;
  const { errors, types } = validateRepo(full);
  const publishedTypes = types.filter(t => !unpublishedIds.has(t.id));
  errors.push(...(await validatePatterns(repo, publishedTypes)));
  if (errors.length) return { repo, catalog: null, errors, notes, unpublishedTypes };

  const catalog = buildCatalog(repo, await patternShas(repo), buildId());

  if (opts.compatUrl) {
    const published = await fetchPublished(opts.compatUrl);
    if (published.status === 'found') {
      errors.push(...checkCompat(published.catalog, catalog));
      const renamed = new Map(renamedTypes(published.catalog, catalog).map(r => [r.from, r.to]));
      for (const id of removedTypes(published.catalog, catalog)) {
        const to = renamed.get(id);
        notes.push(to
          ? `type renamed: ${id} → ${to} (old id kept as an alias)`
          : `type removed: ${id} (will be dropped from the published catalog)`);
      }
      for (const id of removedPatterns(published.catalog, catalog)) {
        notes.push(`pattern removed: ${id} (will be dropped from the published catalog)`);
      }
      notes.push(`compatibility checked against build ${published.catalog.build} (${opts.compatUrl})`);
    } else {
      notes.push(`compatibility check skipped: ${published.reason}`);
    }
  }
  return { repo, catalog: errors.length ? null : catalog, errors, notes, unpublishedTypes };
}
