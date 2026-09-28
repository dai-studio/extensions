/**
 * npm run sign
 *
 * Signs dist/catalog.json in place: every type, then the catalog itself.
 *
 * Env:
 *   DAI_SIGNING_JWK  private key JWK (JSON string). CI: `publish` environment secret.
 *   DAI_SIGNING_KID  key id; must have a public key committed at keys/<kid>.json
 *                    (skip that check with --ephemeral for dry runs).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { importPrivateKey, importPublicKey, signObject, verifyObject } from './lib/crypto.ts';
import { ROOT } from './lib/repo.ts';
import type { Catalog } from './lib/catalog.ts';

const ephemeral = process.argv.includes('--ephemeral');
const jwkJson = process.env.DAI_SIGNING_JWK;
const kid = process.env.DAI_SIGNING_KID;
if (!jwkJson || !kid) {
  console.error('DAI_SIGNING_JWK and DAI_SIGNING_KID must be set.');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kid)) {
  console.error('DAI_SIGNING_KID must match ^[a-z0-9][a-z0-9-]{0,63}$');
  process.exit(1);
}

const privateJwk = JSON.parse(jwkJson) as JsonWebKey;
const publicJwk: JsonWebKey = { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y };

if (!ephemeral) {
  const keyFile = path.join(ROOT, 'keys', `${kid}.json`);
  if (!existsSync(keyFile)) {
    console.error(`keys/${kid}.json not found — commit the public key for this kid first (npm run keygen).`);
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(keyFile, 'utf8')) as JsonWebKey;
  if (committed.x !== publicJwk.x || committed.y !== publicJwk.y || committed.crv !== publicJwk.crv) {
    console.error(`DAI_SIGNING_JWK does not match the committed public key keys/${kid}.json.`);
    process.exit(1);
  }
}

const file = path.join(ROOT, 'dist', 'catalog.json');
const catalog = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
const privateKey = await importPrivateKey(privateJwk);
const publicKey = await importPublicKey(publicJwk);

const types = [];
for (const t of catalog.types) types.push(await signObject(privateKey, kid, t));
const signed = await signObject(privateKey, kid, { ...catalog, types } as unknown as Record<string, unknown>);

// Self-check with the public half before anything leaves this machine.
for (const t of signed.types as Record<string, unknown>[]) {
  if (!(await verifyObject(publicKey, t))) throw new Error(`self-verify failed for ${String(t.id)}`);
}
if (!(await verifyObject(publicKey, signed))) throw new Error('self-verify failed for catalog');

writeFileSync(file, JSON.stringify(signed, null, 2) + '\n');
console.log(`✓ signed ${types.length} types + catalog with kid "${kid}"${ephemeral ? ' (ephemeral key)' : ''}`);
