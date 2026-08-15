// api/list.js - coach-only list of profile submissions.
// Converted from COACH_PASSWORD to session auth (is_coach flag).
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, { requireCoach: true });
  if (!session) return;

  try {
    const loginRows = await sql`
      select id, token_version from logins where id = ${session.lid} limit 1
    `;
    if (loginRows.length === 0) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    if (!checkVersion(session, loginRows[0])) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    const rows = await sql`
      select id, created_at, full_name, jersey, player_id
      from submissions
      order by created_at desc
    `;

    return res.status(200).json({
      ok: true,
      rows: rows.map(function (r) {
        return {
          id: Number(r.id),
          createdAt: r.created_at,
          fullName: r.full_name,
          jersey: r.jersey,
          playerId: r.player_id == null ? null : Number(r.player_id)
        };
      })
    });
  } catch (err) {
    console.error('list failed:', err);
    return res.status(500).json({ error: 'Could not load submissions.' });
  }
}