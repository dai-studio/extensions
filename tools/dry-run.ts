/**
 * npm run dry-run
 *
 * Proves the sign step works on an unprivileged runner (PRs, forks, local):
 * signs dist/ with a throwaway key, re-verifies every signature and pattern
 * hash, and prints the publish plan. Nothing is uploaded.
 * Run `npm run build` first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateKeyPair, importPublicKey, sha256Hex, verifyObject } from './lib/crypto.ts';
import { ROOT } from './lib/repo.ts';
import type { Catalog } from './lib/catalog.ts';

const { privateJwk, publicJwk } = await generateKeyPair();
execFileSync(process.execPath, [path.join(ROOT, 'tools/sign.ts'), '--ephemeral'], {
  stdio: 'inherit',
  env: { ...process.env, DAI_SIGNING_JWK: JSON.stringify(privateJwk), DAI_SIGNING_KID: 'ephemeral' },
});

const catalog = JSON.parse(readFileSync(path.join(ROOT, 'dist/catalog.json'), 'utf8')) as Catalog;
const key = await importPublicKey(publicJwk);
if (!(await verifyObject(key, catalog as unknown as Record<string, unknown>))) throw new Error('catalog signature invalid');
for (const t of catalog.types) if (!(await verifyObject(key, t))) throw new Error(`${t.id}: signature invalid`);
for (const p of catalog.patterns) {
  const sha = await sha256Hex(readFileSync(path.join(ROOT, 'dist/patterns', `${p.id}.dai`), 'utf8'));
  if (sha !== p.sha256) throw new Error(`${p.id}: sha256 mismatch`);
}
console.log(`✓ dry run OK: ${catalog.types.length} types, ${catalog.patterns.length} patterns verified (build ${catalog.build})`);
