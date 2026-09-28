/**
 * Regenerates test-vectors/canonical.json. The key pair is ephemeral and
 * TEST-ONLY — its public key is never trusted by the editor.
 *
 *   node tools/test/make-vectors.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, signablePayload } from '../lib/canonical.ts';
import { generateKeyPair, importPrivateKey, signString } from '../lib/crypto.ts';
import { ROOT } from '../lib/repo.ts';

const inputs: unknown[] = [
  { b: 1, a: 2 },
  { z: { y: [3, 1, { d: true, c: false }], x: 'é "quoted" \\ /' }, a: [] },
  { Z: 1, a: 1, _: 1, '10': 1, '9': 1 },
  { nested: { undef: undefined, keep: 0, empty: '' } },
  [1, 'two', { three: 3 }],
  'plain',
  12.5,
  { unicode: '□◆⬡ 📁', emoji: '🚀', newline: 'a\nb\tc' },
  {
    id: 'dai.types.test.sample', version: '1.0.0', name: 'Sample', kid: 'test',
    form: [{ key: 'name', label: 'Name', type: 'text', storage: 'native' }],
    colors: { stroke: '#000', fill: '#fff' },
  },
];

const { privateJwk, publicJwk } = await generateKeyPair();
const key = await importPrivateKey(privateJwk);

const canonical = inputs.map(input => ({
  input: input === undefined ? null : JSON.parse(JSON.stringify(input, (_k, v) => (v === undefined ? '__undefined__' : v))),
  canonical: canonicalJson(input),
}));
const signed = [];
for (const input of inputs.filter(i => i && typeof i === 'object' && !Array.isArray(i)) as Record<string, unknown>[]) {
  const payload = signablePayload(input);
  signed.push({ payload, signature: await signString(key, payload) });
}

mkdirSync(path.join(ROOT, 'test-vectors'), { recursive: true });
writeFileSync(
  path.join(ROOT, 'test-vectors', 'canonical.json'),
  JSON.stringify({
    $comment: 'Shared with ws-dai-studio. "__undefined__" string values stand for JS undefined and must be dropped by canonicalJson. The signing key is TEST-ONLY.',
    testPublicKey: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    canonical,
    signed,
  }, null, 2) + '\n',
);
console.log('wrote test-vectors/canonical.json');
