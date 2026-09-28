/**
 * npm run keygen -- <kid>
 *
 * Generates a new ECDSA P-256 signing keypair.
 *   - Public key  → keys/<kid>.json (commit this; also add it to
 *                   ws-dai-studio/editor-src/src/lib/types/publicKeys.ts)
 *   - Private key → <kid>.private.jwk in the repo root (git-ignored).
 *                   Store it as the GitHub environment SECRET DAI_SIGNING_JWK,
 *                   set the environment VARIABLE DAI_SIGNING_KID to the text
 *                   <kid> (the id, not a key), then DELETE the local file.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateKeyPair } from './lib/crypto.ts';
import { ROOT } from './lib/repo.ts';

const kid = process.argv[2];
if (!kid || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(kid)) {
  console.error('usage: npm run keygen -- <kid>   (kid like "ci-2026-09")');
  process.exit(1);
}
const pubFile = path.join(ROOT, 'keys', `${kid}.json`);
const privFile = path.join(ROOT, `${kid}.private.jwk`);
if (existsSync(pubFile) || existsSync(privFile)) {
  console.error(`A key for "${kid}" already exists.`);
  process.exit(1);
}

const { privateJwk, publicJwk } = await generateKeyPair();
const pub = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y };
mkdirSync(path.dirname(pubFile), { recursive: true });
writeFileSync(pubFile, JSON.stringify(pub, null, 2) + '\n');
writeFileSync(privFile, JSON.stringify(privateJwk) + '\n', { mode: 0o600 });

console.log(`public key  → ${path.relative(ROOT, pubFile)} (commit; also add to the editor's publicKeys.ts under '${kid}')`);
console.log(`private key → ${path.relative(ROOT, privFile)} (git-ignored)`);
console.log('');
console.log('For each GitHub environment (publish-dev, publish-prod):');
console.log(`  gh secret   set DAI_SIGNING_JWK --env <env> < ${path.relative(ROOT, privFile)}`);
console.log(`  gh variable set DAI_SIGNING_KID --env <env> --body ${kid}`);
console.log(`Then delete ${path.relative(ROOT, privFile)}.`);
