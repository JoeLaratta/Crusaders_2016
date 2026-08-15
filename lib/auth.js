// lib/auth.js
// NODE RUNTIME ONLY. Do not import this from middleware.js — scrypt does not
// exist on the Edge runtime. Middleware imports lib/token.js directly.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Re-export the isomorphic half so API routes only ever import lib/auth.js.
export {
  COOKIE_NAME,
  createToken,
  readToken,
  sessionCookie,
  clearCookie,
  parseCookie,
  readCookie
} from './token.js';

import { readToken, readCookie, COOKIE_NAME } from './token.js';

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain, salt, 64);
  return 's1$' + salt.toString('base64url') + '$' + key.toString('base64url');
}

export async function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts[0] !== 's1') return false;
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = await scryptAsync(plain, salt, expected.length);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

// 14 chars incl. two dashes. Alphabet excludes I, O, 0, 1 so Steve can read
// them aloud over the phone without ambiguity.
export function makeTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

// Signature + expiry only. Does NOT hit the DB.
// Returns the payload, or null.
export async function getSession(req) {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;
  return readToken(raw);
}

// Standard guard for every protected API route.
// Writes the 401/403 response itself and returns null when it rejects, so
// callers just do:  const s = await requireSession(req, res); if (!s) return;
//
// opts.allowMustChange  - true only for change-password + logout
// opts.requireCoach     - true for coach-only endpoints
export async function requireSession(req, res, opts) {
  const o = opts || {};
  const payload = await getSession(req);
  if (!payload) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  if (payload.mc && !o.allowMustChange) {
    res.status(403).json({ error: 'Password change required', mustChange: true });
    return null;
  }
  if (o.requireCoach && !payload.coach) {
    res.status(403).json({ error: 'Not authorized' });
    return null;
  }
  return payload;
}

// token_version lives in the DB, so revocation must be checked by the caller
// that already has a sql client. Pattern:
//   const rows = await sql`select token_version from logins where id = ${s.lid}`;
//   if (!checkVersion(s, rows[0])) return res.status(401).json({ error: 'Session revoked' });
export function checkVersion(payload, loginRow) {
  if (!loginRow) return false;
  return Number(loginRow.token_version) === Number(payload.ver);
}