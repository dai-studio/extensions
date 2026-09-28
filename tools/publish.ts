/**
 * npm run publish:r2 -- --bucket <bucket>
 *
 * Uploads a signed dist/ to R2 as an immutable build, then flips the
 * pointer. Upload order matters: catalog/current.json is written LAST, so a
 * failed/partial upload leaves the previous build live.
 *
 *   catalog/builds/<build>/patterns/<id>.dai
 *   catalog/builds/<build>/catalog.json
 *   catalog/current.json                     { "build": "<build>", "publishedAt": "…" }
 *
 * Env: CLOUDFLARE_API_TOKEN (R2 write, scoped to the bucket), CLOUDFLARE_ACCOUNT_ID.
 * Use --dry-run to print the plan without uploading.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.ts';
import { sha256Hex } from './lib/crypto.ts';
import type { Catalog } from './lib/catalog.ts';

const args = process.argv.slice(2);
const bucket = args[args.indexOf('--bucket') + 1];
const dryRun = args.includes('--dry-run');
if (!args.includes('--bucket') || !bucket) {
  console.error('usage: npm run publish:r2 -- --bucket <bucket> [--dry-run]');
  process.exit(1);
}

const dist = path.join(ROOT, 'dist');
const catalogFile = path.join(dist, 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as Catalog;
if (!catalog.signature || !catalog.kid) {
  console.error('dist/catalog.json is not signed — run `npm run sign` first.');
  process.exit(1);
}
if (catalog.build.endsWith('-dirty') || catalog.build === 'local') {
  console.error(`Refusing to publish a non-commit build (${catalog.build}).`);
  process.exit(1);
}

const prefix = `catalog/builds/${catalog.build}`;
const uploads: Array<{ key: string; file: string; contentType: string }> = [];
for (const p of catalog.patterns) {
  const file = path.join(dist, 'patterns', `${p.id}.dai`);
  const sha = await sha256Hex(readFileSync(file, 'utf8'));
  if (sha !== p.sha256) throw new Error(`${p.id}: dist file does not match catalog sha256`);
  uploads.push({ key: `${prefix}/patterns/${p.id}.dai`, file, contentType: 'application/xml; charset=UTF-8' });
}
uploads.push({ key: `${prefix}/catalog.json`, file: catalogFile, contentType: 'application/json; charset=UTF-8' });

const pointerFile = path.join(mkdtempSync(path.join(tmpdir(), 'dai-catalog-')), 'current.json');
writeFileSync(pointerFile, JSON.stringify({ build: catalog.build, publishedAt: catalog.publishedAt }) + '\n');
uploads.push({ key: 'catalog/current.json', file: pointerFile, contentType: 'application/json; charset=UTF-8' });

for (const u of uploads) {
  const cmd = ['wrangler@4', 'r2', 'object', 'put', `${bucket}/${u.key}`, '--file', u.file, '--content-type', u.contentType, '--remote'];
  console.log(`${dryRun ? '[dry-run] ' : ''}npx ${cmd.join(' ')}`);
  if (!dryRun) execFileSync('npx', ['--yes', ...cmd], { stdio: 'inherit' });
}
console.log(`✓ ${dryRun ? 'planned' : 'published'} build ${catalog.build} to ${bucket}`);
