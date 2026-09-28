import { execFileSync } from 'node:child_process';
import { sha256Hex } from './crypto.ts';
import { buildCatalog, type Catalog } from './catalog.ts';
import { checkCompat, fetchPublished } from './compat.ts';
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
  repo: Repo;
  catalog: Catalog | null;
  errors: string[];
  notes: string[];
}

/**
 * Full validation (schema, semantics, patterns and — when `compatUrl` is set —
 * additive-only compatibility against the published catalog).
 */
export async function checkAll(opts: { compatUrl?: string } = {}): Promise<CheckResult> {
  const repo = loadRepo();
  const notes: string[] = [];
  const { errors, types } = validateRepo(repo);
  errors.push(...(await validatePatterns(repo, types)));
  if (errors.length) return { repo, catalog: null, errors, notes };

  const catalog = buildCatalog(repo, await patternShas(repo), buildId());

  if (opts.compatUrl) {
    const published = await fetchPublished(opts.compatUrl);
    if (published.status === 'found') {
      errors.push(...checkCompat(published.catalog, catalog));
      notes.push(`compatibility checked against build ${published.catalog.build} (${opts.compatUrl})`);
    } else {
      notes.push(`compatibility check skipped: ${published.reason}`);
    }
  }
  return { repo, catalog: errors.length ? null : catalog, errors, notes };
}
