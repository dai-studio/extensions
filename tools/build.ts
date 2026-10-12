/**
 * npm run build [-- --against <catalog-url>]
 *
 * Validates, then writes the unsigned catalog to dist/:
 *   dist/catalog.json
 *   dist/patterns/<id>.dai
 * Run `npm run sign` afterwards to add signatures.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkAll } from './lib/pipeline.ts';
import { ROOT } from './lib/repo.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--against');
const compatUrl = i >= 0 ? args[i + 1] : process.env.CATALOG_COMPAT_URL;

const { repo, catalog, errors, notes } = await checkAll({ compatUrl });
for (const n of notes) console.log(`note: ${n}`);
if (!catalog) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\nBuild aborted: ${errors.length} problem(s).`);
  process.exit(1);
}

const dist = path.join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'patterns'), { recursive: true });
for (const p of repo.patterns) writeFileSync(path.join(dist, 'patterns', `${p.id}.dai`), p.xml);
const json = JSON.stringify(catalog, null, 2) + '\n';
writeFileSync(path.join(dist, 'catalog.json'), json);

/** Soft budget: the editor fetches the whole catalog on load. */
const CATALOG_WARN_BYTES = 2 * 1024 * 1024;
const bytes = Buffer.byteLength(json, 'utf8');
if (bytes > CATALOG_WARN_BYTES) console.warn(`warning: catalog.json is ${(bytes / 1024 / 1024).toFixed(2)} MB (budget 2 MB)`);

console.log(`✓ built ${catalog.types.length} types, ${catalog.patterns.length} patterns → dist/ (build ${catalog.build}, unsigned)`);
