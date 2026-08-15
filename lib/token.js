// lib/token.js
// Runs on BOTH the Edge runtime (middleware.js) and Node (api/*.js).
// Therefore: no node:crypto, no Buffer. Web Crypto + TextEncoder only.

const SESSION_HOURS = 12;
export const COOKIE_NAME = 'cru_session';

const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}

function stringFromB64url(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function sign(payloadB64) {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return b64urlFromBytes(new Uint8Array(sig));
}

// Constant-time-ish compare. Length is not secret here (HMAC output is fixed width).
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// opts: { loginId, tokenVersion, mustChange, isCoach }
export async function createToken(opts) {
  const payload = {
    lid: opts.loginId,
    ver: opts.tokenVersion,
    mc: !!opts.mustChange,
    coach: !!opts.isCoach,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  };
  const b64 = b64urlFromString(JSON.stringify(payload));
  return b64 + '.' + (await sign(b64));
}

// Returns the payload object, or null if forged / malformed / expired.
// NOTE: does NOT check token_version against the DB. Callers that touch data
// must re-check payload.ver. Middleware cannot (no DB on Edge).
export async function readToken(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    const expected = await sign(parts[0]);
    if (!safeEqual(expected, parts[1])) return null;
    const payload = JSON.parse(stringFromB64url(parts[0]));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// No Max-Age: dies on browser close. The exp claim is the real 12h bound.
export function sessionCookie(token) {
  return COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict';
}

export function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

// Accepts a raw Cookie header string. Works from either runtime.
export function parseCookie(rawHeader, name) {
  const raw = rawHeader || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    if (parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
  }
  return null;
}

// Node API routes: readCookie(req, COOKIE_NAME)
// Edge middleware:  parseCookie(request.headers.get('cookie'), COOKIE_NAME)
export function readCookie(req, name) {
  return parseCookie(req && req.headers ? req.headers.cookie : '', name);
}