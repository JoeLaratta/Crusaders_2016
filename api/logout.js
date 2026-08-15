// api/logout.js - clears the session cookie. Accepts a must_change token so a
// parent stuck on the forced-change screen can still sign out.
import { clearCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Unconditional: clearing a cookie needs no valid session, and a user with a
  // broken/expired token still deserves a clean logout.
  res.setHeader('Set-Cookie', clearCookie());
  return res.status(200).json({ ok: true });
}