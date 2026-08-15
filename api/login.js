// api/login.js — public endpoint. Exchanges username+password for a session cookie.
import { neon } from '@neondatabase/serverless';
import { hashPassword, verifyPassword, createToken, sessionCookie } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

// Precomputed throwaway hash. Verifying against this on an unknown username
// costs the same as a real check, so response time does not reveal which
// usernames exist. Value is irrelevant — nothing can match it.
const DUMMY_HASH =
  's1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const rows = await sql`
      select id, password_hash, must_change, token_version, is_coach
      from logins
      where username = ${username}
      limit 1
    `;

    const found = rows.length > 0;
    const stored = found ? rows[0].password_hash : DUMMY_HASH;
    const ok = await verifyPassword(password, stored);

    // Same message either way — never confirm whether a username exists.
    if (!found || !ok) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const row = rows[0];
    const token = await createToken({
      loginId: Number(row.id),
      tokenVersion: Number(row.token_version),
      mustChange: row.must_change === true,
      isCoach: row.is_coach === true
    });

    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.status(200).json({
      ok: true,
      mustChange: row.must_change === true,
      isCoach: row.is_coach === true
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}