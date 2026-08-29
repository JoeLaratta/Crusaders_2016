// api/me.js - session identity + the players this login is allowed to see.
//
// GET /api/me           lightweight: identity + player names/jerseys.
//                       Called on every page load for the handbook nav, so it
//                       deliberately carries no image bytes.
// GET /api/me?cards=1   adds photo + latest submission data for each player,
//                       for the parent-facing player card page.
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

    const wantsCards = String((req.query && req.query.cards) || '') === '1';

    if (wantsCards) {
      // distinct on picks the newest submission per player, so a parent who
      // filled the form more than once gets their most recent answers.
      // Still scoped by login_players - same guarantee as the light path.
      const rows = await sql`
        select distinct on (p.id)
               p.id, p.name, p.jersey, p.photo,
               s.id as submission_id, s.full_name, s.data, s.created_at
        from players p
        join login_players lp on lp.player_id = p.id
        left join submissions s on s.player_id = p.id
        where lp.login_id = ${session.lid}
        order by p.id, s.created_at desc nulls last
      `;
      // Re-sort by name: distinct on forces ordering by p.id first.
      const cards = rows.map(function (r) {
        return {
          id: Number(r.id),
          name: r.name,
          jersey: r.jersey,
          photo: r.photo == null ? null : r.photo,
          submittedName: r.full_name == null ? null : r.full_name,
          submittedAt: r.created_at == null ? null : r.created_at,
          data: r.data == null ? null : r.data
        };
      }).sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
      });
      return res.status(200).json({
        loginId: Number(loginRows[0].id),
        username: loginRows[0].username,
        isCoach: loginRows[0].is_coach === true,
        players: cards
      });
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
