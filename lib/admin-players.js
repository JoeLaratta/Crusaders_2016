// api/admin-players.js - coach-only roster management.
// GET    list players with submission/report/login counts
// POST   create a player   { name, jersey }
// PATCH  update a player   { id, name, jersey }
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from './auth.js';

const sql = neon(process.env.DATABASE_URL);

async function guard(req, res) {
  const session = await requireSession(req, res, { requireCoach: true });
  if (!session) return null;
  const rows = await sql`
    select id, token_version from logins where id = ${session.lid} limit 1
  `;
  if (rows.length === 0) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  if (!checkVersion(session, rows[0])) {
    res.status(401).json({ error: 'Session expired, please sign in again' });
    return null;
  }
  return session;
}

function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
}

function cleanName(v) {
  return String(v == null ? '' : v).trim().replace(/\s{2,}/g, ' ').slice(0, 120);
}

function cleanJersey(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  return s === '' ? null : s;
}

export default async function handler(req, res) {
  const method = req.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'PUT') {
    res.setHeader('Allow', 'GET, POST, PATCH, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await guard(req, res);
  if (!session) return;

  try {
    if (method === 'GET') {
      // Counts come from correlated subqueries so a player with zero of
      // anything still appears in the list.
      const rows = await sql`
        select p.id, p.name, p.jersey, p.created_at,
               (select count(*) from submissions s where s.player_id = p.id) as submission_count,
               (select count(*) from reports r where r.player_id = p.id) as report_count,
               (select count(*) from login_players lp where lp.player_id = p.id) as login_count
        from players p
        order by p.name
      `;
      return res.status(200).json({
        players: rows.map(function (p) {
          return {
            id: Number(p.id),
            name: p.name,
            jersey: p.jersey,
            createdAt: p.created_at,
            submissionCount: Number(p.submission_count),
            reportCount: Number(p.report_count),
            loginCount: Number(p.login_count)
          };
        })
      });
    }

    const body = readBody(req);

    if (method === 'POST') {
      const name = cleanName(body.name);
      if (!name) {
        return res.status(400).json({ error: 'Player name is required' });
      }
      const jersey = cleanJersey(body.jersey);

      // Warn rather than block: two kids really can share a first name.
      const dupes = await sql`
        select id from players where lower(name) = lower(${name}) limit 1
      `;

      const inserted = await sql`
        insert into players (name, jersey, created_at)
        values (${name}, ${jersey}, now())
        returning id, name, jersey
      `;
      return res.status(201).json({
        player: {
          id: Number(inserted[0].id),
          name: inserted[0].name,
          jersey: inserted[0].jersey
        },
        duplicateName: dupes.length > 0
      });
    }

    if (method === 'PUT') {
      // Link or unlink an existing submission to a player. Pass playerId null to unlink.
      const submissionId = Number(body.submissionId);
      if (!Number.isInteger(submissionId) || submissionId <= 0 || submissionId > Number.MAX_SAFE_INTEGER) {
        return res.status(400).json({ error: 'Invalid submission id' });
      }
      let targetPlayer = null;
      if (body.playerId !== null && body.playerId !== undefined && body.playerId !== '') {
        targetPlayer = Number(body.playerId);
        if (!Number.isInteger(targetPlayer) || targetPlayer <= 0 || targetPlayer > Number.MAX_SAFE_INTEGER) {
          return res.status(400).json({ error: 'Invalid player id' });
        }
        const exists = await sql`select id from players where id = ${targetPlayer} limit 1`;
        if (exists.length === 0) {
          return res.status(404).json({ error: 'Player not found' });
        }
      }
      const linked = await sql`update submissions set player_id = ${targetPlayer} where id = ${submissionId} returning id, player_id`;
      if (linked.length === 0) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      return res.status(200).json({
        submissionId: Number(linked[0].id),
        playerId: linked[0].player_id == null ? null : Number(linked[0].player_id)
      });
    }

    // PATCH
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ error: 'Invalid player id' });
    }
    const name = cleanName(body.name);
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }
    const jersey = cleanJersey(body.jersey);

    const updated = await sql`
      update players set name = ${name}, jersey = ${jersey}
      where id = ${id}
      returning id, name, jersey
    `;
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    return res.status(200).json({
      player: {
        id: Number(updated[0].id),
        name: updated[0].name,
        jersey: updated[0].jersey
      }
    });
  } catch (err) {
    console.error('admin-players error', err);
    return res.status(500).json({ error: 'Could not complete that action' });
  }
}