// middleware.js - gates every static route. Runs on the Vercel EDGE runtime,
// so this file and everything it imports must avoid node:crypto and Buffer.
// It imports lib/token.js (isomorphic), NOT lib/auth.js (Node-only scrypt).
import { next } from '@vercel/functions';
import { readToken, parseCookie, COOKIE_NAME } from './lib/token.js';

// Reachable without a session.
const PUBLIC_PATHS = new Set([
  '/',
  '/index.html',
  '/login.html',
  '/favicon.ico',
  '/robots.txt'
]);

// Deliberately NOT a wildcard. Any extension left off this list stays gated,
// so a stray .json or .pdf in the deploy folder is never served to strangers.
const PUBLIC_EXTENSIONS = [
  '.css', '.js', '.mjs', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp3', '.mp4', '.webm'
];

function isPublic(path) {
  if (PUBLIC_PATHS.has(path)) return true;
  const lower = path.toLowerCase();
  for (let i = 0; i < PUBLIC_EXTENSIONS.length; i++) {
    if (lower.endsWith(PUBLIC_EXTENSIONS[i])) return true;
  }
  return false;
}

function redirectTo(origin, path) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: origin + path,
      // Never let a redirect get cached - it would strand a logged-in user.
      'Cache-Control': 'no-store'
    }
  });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (isPublic(path)) return next();

  try {
    const raw = parseCookie(request.headers.get('cookie'), COOKIE_NAME);
    const session = raw ? await readToken(raw) : null;

    // No session, expired, or forged signature.
    if (!session) return redirectTo(url.origin, '/login.html');

    // Limited token: only the forced-change screen is reachable.
    if (session.mc) return redirectTo(url.origin, '/login.html');

    // Page-level role split. This is UX only - the real coach gate is
    // requireSession({ requireCoach: true }) inside the API routes.
    if (path === '/coach.html' && !session.coach) {
      return redirectTo(url.origin, '/reports.html');
    }

    return next();
  } catch (err) {
    // Fail CLOSED. If SESSION_SECRET is missing or crypto throws, send people
    // to the login page rather than serving the gated file.
    console.error('middleware error', err);
    return redirectTo(url.origin, '/login.html');
  }
}

// /api/* is excluded: each route self-guards with requireSession, and those
// checks are stronger than anything Edge can do (they verify token_version
// against the database). Intercepting them here would also return HTML
// redirects to fetch() callers.
export const config = {
  matcher: ['/((?!api/).*)']
};