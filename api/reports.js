// api/reports.js - lists progress reports visible to the signed-in login.
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
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

    // The join to login_players IS the authorization. A report with no link
    // to this login simply produces no row. r.pdf is never selected here -
    // the blobs would make this response enormous.
    const rows = await sql`
      select r.id, r.title, r.published_at,
             p.id as player_id, p.name as player_name, p.jersey,
             (rv.report_id is not null) as viewed,
             rv.viewed_at
      from reports r
      join players p on p.id = r.player_id
      join login_players lp on lp.player_id = p.id and lp.login_id = ${session.lid}
      left join report_views rv on rv.report_id = r.id and rv.login_id = ${session.lid}
      order by r.published_at desc, r.id desc
    `;

    return res.status(200).json({
      reports: rows.map(function (r) {
        return {
          id: Number(r.id),
          title: r.title,
          publishedAt: r.published_at,
          playerId: Number(r.player_id),
          playerName: r.player_name,
          jersey: r.jersey,
          viewed: r.viewed === true,
          viewedAt: r.viewed_at
        };
      })
    });
  } catch (err) {
    console.error('reports error', err);
    return res.status(500).json({ error: 'Could not load reports' });
  }
}