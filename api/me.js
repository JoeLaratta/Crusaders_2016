// api/me.js - session identity + the players this login is allowed to see.
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // No allowMustChange: a limited token must NOT reach real data.
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const loginRows = await sql`
      select id, username, token_version, is_coach
      from logins
      where id = ${session.lid}
      limit 1
    `;
    if (loginRows.length === 0) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    if (!checkVersion(session, loginRows[0])) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    // Scoped by login_players - a login can never see a player it is not linked to.
    const players = await sql`
      select p.id, p.name, p.jersey
      from players p
      join login_players lp on lp.player_id = p.id
      where lp.login_id = ${session.lid}
      order by p.name
    `;

    return res.status(200).json({
      loginId: Number(loginRows[0].id),
      username: loginRows[0].username,
      isCoach: loginRows[0].is_coach === true,
      players: players.map(function (p) {
        return { id: Number(p.id), name: p.name, jersey: p.jersey };
      })
    });
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'Could not load session' });
  }
}