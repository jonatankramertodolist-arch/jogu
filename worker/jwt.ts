import { HttpError } from './http';

/**
 * Verifies Google's id tokens without an auth library.
 *
 * The browser hands us a token that Google signed. We check that signature
 * against Google's published keys, which is what makes the claim "this really is
 * that person's account" trustworthy. Skipping the signature check and simply
 * decoding the payload would let anyone log in as anyone.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google is inconsistent about the scheme, and both forms are legitimate. */
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** Tolerance for clock skew between Google and Cloudflare, in seconds. */
const LEEWAY_SECONDS = 60;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

interface JwtHeader {
  alg: string;
  kid: string;
}

interface GoogleClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface JwkSet {
  keys: (JsonWebKey & { kid: string; alg?: string })[];
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    throw new HttpError(401, 'Inloggningen kunde inte läsas.');
  }
}

/**
 * Google's keys rotate, so they are fetched rather than pinned. Held in the
 * isolate between requests and also cached at the edge, which keeps a burst of
 * logins from turning into a burst of outbound requests.
 */
let cachedKeys: { keys: JwkSet['keys']; until: number } | null = null;

async function googleKeys(): Promise<JwkSet['keys']> {
  if (cachedKeys && cachedKeys.until > Date.now()) return cachedKeys.keys;

  const response = await fetch(JWKS_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new HttpError(503, 'Kunde inte nå Google för att verifiera inloggningen.');

  const set = (await response.json()) as JwkSet;
  if (!Array.isArray(set.keys) || set.keys.length === 0) {
    throw new HttpError(503, 'Google svarade utan nycklar.');
  }

  cachedKeys = { keys: set.keys, until: Date.now() + 3_600_000 };
  return set.keys;
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
): Promise<GoogleIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Inloggningen såg inte ut som väntat.');

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonPart<JwtHeader>(headerPart);

  // Only RS256 is accepted. Trusting the token's own choice of algorithm is the
  // classic way these checks get bypassed, for instance by asking for "none".
  if (header.alg !== 'RS256') throw new HttpError(401, 'Inloggningen använde en oväntad signatur.');

  const jwk = (await googleKeys()).find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Inloggningen signerades med en okänd nyckel.');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(signaturePart),
    signed,
  );
  if (!valid) throw new HttpError(401, 'Inloggningens signatur stämde inte.');

  const claims = decodeJsonPart<GoogleClaims>(payloadPart);
  const now = Math.floor(Date.now() / 1000);

  if (!ISSUERS.includes(claims.iss)) throw new HttpError(401, 'Inloggningen kom inte från Google.');
  // Without this the token from any other Google app would be accepted here.
  if (claims.aud !== clientId) throw new HttpError(401, 'Inloggningen gällde en annan app.');
  if (claims.exp + LEEWAY_SECONDS < now) throw new HttpError(401, 'Inloggningen har gått ut.');
  if (claims.iat - LEEWAY_SECONDS > now) throw new HttpError(401, 'Inloggningen är daterad framåt.');
  if (!claims.sub) throw new HttpError(401, 'Inloggningen saknade konto-id.');
  if (!claims.email || claims.email_verified === false) {
    throw new HttpError(401, 'Google-kontot har ingen bekräftad e-postadress.');
  }

  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? '',
    picture: claims.picture ?? null,
  };
}
