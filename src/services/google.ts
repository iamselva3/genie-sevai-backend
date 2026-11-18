import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../utils/errors';

export interface GoogleProfile {
  /** Google's stable account id. */
  sub: string;
  email: string;
  name: string;
  picture: string;
}

const invalid = () => new AppError(401, 'Your Google sign-in has expired. Please try again.', 'GOOGLE_INVALID');

/**
 * Verifies an OAuth access token from Google Identity Services (the web app's "Continue with Google"
 * button) and returns the account it belongs to. The token must have been issued to one of our OAuth
 * clients and belong to a verified email address.
 */
export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleProfile> {
  if (config.google.testSecret && accessToken.startsWith('test.')) return verifyTestToken(accessToken);
  if (config.google.clientIds.length === 0) {
    throw new AppError(503, 'Google sign-in is not set up on the server yet.', 'GOOGLE_NOT_CONFIGURED');
  }

  let info: Record<string, unknown>;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw invalid();
    info = (await res.json()) as Record<string, unknown>;
  } catch {
    throw invalid();
  }

  const clients = new Set(config.google.clientIds);
  if (!clients.has(String(info.aud)) && !clients.has(String(info.azp))) {
    throw new AppError(401, 'This Google sign-in was meant for a different app.', 'GOOGLE_WRONG_CLIENT');
  }
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!info.sub || !info.email || !verified) {
    throw new AppError(401, 'Your Google account email is not verified.', 'GOOGLE_UNVERIFIED');
  }

  // Name and photo are nice to have; the identity is already confirmed above.
  let name = '';
  let picture = '';
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const profile = (await res.json()) as { name?: string; picture?: string };
      name = profile.name || '';
      picture = profile.picture || '';
    }
  } catch {
    /* optional */
  }

  return { sub: String(info.sub), email: String(info.email).toLowerCase().trim(), name, picture };
}

/* ---------------- Test tokens ---------------- */
// The automated tests cannot sign in to a real Google account. When GOOGLE_TEST_SECRET is set (never in
// production) the API also accepts "test.<payload>.<signature>" tokens signed with that secret.

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signTestToken(profile: Pick<GoogleProfile, 'sub' | 'email'> & Partial<GoogleProfile>, secret: string) {
  const payload = b64(JSON.stringify(profile));
  return `test.${payload}.${b64(createHmac('sha256', secret).update(payload).digest())}`;
}

function verifyTestToken(token: string): GoogleProfile {
  const [, payload = '', signature = ''] = token.split('.');
  const expected = createHmac('sha256', config.google.testSecret).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
  let p: Partial<GoogleProfile>;
  try {
    p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<GoogleProfile>;
  } catch {
    throw invalid();
  }
  if (!p.sub || !p.email) throw invalid();
  return { sub: p.sub, email: p.email.toLowerCase(), name: p.name || '', picture: p.picture || '' };
}
