/**
 * npm run sign
 *
 * Signs dist/catalog.json in place: every type, then the catalog itself.
 *
 * Env (CI: set on the publish-dev / publish-prod GitHub environments):
 *   DAI_SIGNING_JWK  SECRET — the private key JWK, i.e. the one-line contents of
 *                    <kid>.private.jwk from `npm run keygen` (contains "d").
 *   DAI_SIGNING_KID  VARIABLE — just the key id string, e.g. `ci-2026-09`
 *                    (the file name of keys/<kid>.json without ".json"; NOT the key).
 *                    Skip the committed-key check with --ephemeral for dry runs.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { importPrivateKey, importPublicKey, signObject, verifyObject } from './lib/crypto.ts';
import { ROOT } from './lib/repo.ts';
import type { Catalog } from './lib/catalog.ts';

function fail(...lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(1);
}

function committedKids(): string[] {
  const dir = path.join(ROOT, 'keys');
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : [];
}

const ephemeral = process.argv.includes('--ephemeral');
const jwkJson = process.env.DAI_SIGNING_JWK?.trim();
const kid = process.env.DAI_SIGNING_KID?.trim();
const kidHint = `Committed kids: ${committedKids().join(', ') || '(none — run npm run keygen -- <kid>)'}`;

if (!jwkJson) fail('DAI_SIGNING_JWK is not set (GitHub: environment *secret* DAI_SIGNING_JWK).');
if (!kid) fail('DAI_SIGNING_KID is not set (GitHub: environment *variable* DAI_SIGNING_KID).', kidHint);
if (kid.startsWith('{')) {
  fail(
    'DAI_SIGNING_KID contains JSON (a key), but it must be just the key id — the',
    'file name of keys/<kid>.json without ".json", e.g. DAI_SIGNING_KID = ci-2026-09.',
    kidHint,
  );
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kid)) {
  fail(`DAI_SIGNING_KID "${kid}" is not a valid key id (lower-case letters, digits and "-", e.g. ci-2026-09).`, kidHint);
}

let privateJwk: JsonWebKey;
try {
  privateJwk = JSON.parse(jwkJson) as JsonWebKey;
} catch {
  fail('DAI_SIGNING_JWK is not valid JSON — paste the full one-line contents of <kid>.private.jwk.');
}
if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.x || !privateJwk.y) {
  fail('DAI_SIGNING_JWK is not an EC P-256 JWK — paste the contents of <kid>.private.jwk from npm run keygen.');
}
if (!privateJwk.d) {
  fail(
    'DAI_SIGNING_JWK is a PUBLIC key (no "d"). The secret must be the PRIVATE key from',
    '<kid>.private.jwk; the public half belongs in keys/<kid>.json and publicKeys.ts.',
  );
}

const publicJwk: JsonWebKey = { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y };

if (!ephemeral) {
  const keyFile = path.join(ROOT, 'keys', `${kid}.json`);
  if (!existsSync(keyFile)) {
    fail(`keys/${kid}.json not found — commit the public key for this kid first (npm run keygen).`, kidHint);
  }
  const committed = JSON.parse(readFileSync(keyFile, 'utf8')) as JsonWebKey;
  if (committed.x !== publicJwk.x || committed.y !== publicJwk.y || committed.crv !== publicJwk.crv) {
    const owner = committedKids().find(k => {
      const c = JSON.parse(readFileSync(path.join(ROOT, 'keys', `${k}.json`), 'utf8')) as JsonWebKey;
      return c.x === publicJwk.x && c.y === publicJwk.y;
    });
    fail(
      `DAI_SIGNING_JWK does not match the committed public key keys/${kid}.json.`,
      owner ? `It matches keys/${owner}.json — set DAI_SIGNING_KID = ${owner}.` : 'It matches no committed key.',
    );
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
