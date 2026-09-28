/**
 * ECDSA P-256 / SHA-256 signing with WebCrypto.
 *
 * WebCrypto emits raw IEEE-P1363 `r||s` (64 bytes), which is what the
 * editor's `crypto.subtle.verify` expects. Do NOT switch to node:crypto
 * `sign()` — it defaults to DER and the editor would reject every signature.
 */
import { signablePayload } from './canonical.ts';

const { subtle } = globalThis.crypto;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIG = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey('jwk', jwk, ALG, false, ['sign']);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey('jwk', jwk, ALG, false, ['verify']);
}

export async function generateKeyPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const pair = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
  return { privateJwk, publicJwk };
}

export async function signString(key: CryptoKey, payload: string): Promise<string> {
  const sig = await subtle.sign(SIG, key, new TextEncoder().encode(payload));
  return base64urlEncode(sig);
}

export async function verifyString(key: CryptoKey, payload: string, signature: string): Promise<boolean> {
  try {
    const sig = base64urlDecode(signature);
    if (sig.byteLength !== 64) return false;
    return await subtle.verify(SIG, key, sig, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

/** Sign an object in place-safe fashion: returns a copy with `kid` + `signature`. */
export async function signObject<T extends Record<string, unknown>>(
  key: CryptoKey,
  kid: string,
  obj: T,
): Promise<T & { kid: string; signature: string }> {
  const withKid = { ...obj, kid } as Record<string, unknown>;
  delete withKid.signature;
  const signature = await signString(key, signablePayload(withKid));
  return { ...(withKid as T), kid, signature };
}

export async function verifyObject(key: CryptoKey, obj: Record<string, unknown>): Promise<boolean> {
  const sig = obj.signature;
  if (typeof sig !== 'string' || !sig) return false;
  return verifyString(key, signablePayload(obj), sig);
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}
