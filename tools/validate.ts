/**
 * npm run validate [-- --against <catalog-url>]
 *
 * Validates every type and pattern. With --against (or CATALOG_COMPAT_URL),
 * also enforces additive-only compatibility with the published catalog.
 */
import { checkAll } from './lib/pipeline.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--against');
const compatUrl = i >= 0 ? args[i + 1] : process.env.CATALOG_COMPAT_URL;

const { repo, errors, notes } = await checkAll({ compatUrl });
for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ ${repo.types.length} types and ${repo.patterns.length} patterns are valid.`);
