// api/change-password.js - the ONLY route reachable while must_change is true.
import { neon } from '@neondatabase/serverless';
import {
  requireSession, checkVersion, hashPassword, verifyPassword,
  createToken, sessionCookie
} from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

const MIN_LEN = 8;
const MAX_LEN = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // allowMustChange: this endpoint must accept the limited token.
  const session = await requireSession(req, res, { allowMustChange: true });
  if (!session) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < MIN_LEN) {
      return res.status(400).json({ error: 'New password must be at least ' + MIN_LEN + ' characters' });
    }
    if (newPassword.length > MAX_LEN) {
      return res.status(400).json({ error: 'New password is too long' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    const rows = await sql`
      select id, password_hash, token_version, is_coach
      from logins
      where id = ${session.lid}
      limit 1
    `;
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Not signed in' });
    }

    // Session was revoked (Steve reset this account mid-session).
    if (!checkVersion(session, rows[0])) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    const ok = await verifyPassword(currentPassword, rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await hashPassword(newPassword);
    const nextVersion = Number(rows[0].token_version) + 1;

    // Bumping token_version kills every other session for this login.
    await sql`
      update logins
      set password_hash = ${newHash},
          must_change = false,
          token_version = ${nextVersion}
      where id = ${session.lid}
    `;

    // Their own token was just invalidated too - hand back a fresh one.
    const token = await createToken({
      loginId: Number(rows[0].id),
      tokenVersion: nextVersion,
      mustChange: false,
      isCoach: rows[0].is_coach === true
    });

    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.status(200).json({ ok: true, isCoach: rows[0].is_coach === true });
  } catch (err) {
    console.error('change-password error', err);
    return res.status(500).json({ error: 'Could not change password' });
  }
}