// api/admin-reports.js - coach-only progress report management.
// GET     list reports with per-login download status
// POST    upload  { playerId, title, pdfBase64 }
// DELETE  remove  { id }
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from './auth.js';

const sql = neon(process.env.DATABASE_URL);

// Vercel caps request bodies at 4.5 MB and base64 inflates by ~33%, so the real
// ceiling is about 3.3 MB of PDF. Cap at 3 MB to leave room for the JSON wrapper.
const MAX_PDF_BYTES = 3 * 1024 * 1024;

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

function validId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

export default async function handler(req, res) {
  const method = req.method;
  if (['GET', 'POST', 'DELETE'].indexOf(method) === -1) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await guard(req, res);
  if (!session) return;

  try {
    if (method === 'GET') {
      // octet_length(pdf) instead of pdf - never pull blobs into a list.
      const rows = await sql`
        select r.id, r.title, r.published_at, octet_length(r.pdf) as size_bytes,
               p.id as player_id, p.name as player_name, p.jersey,
               (select count(*) from login_players lp where lp.player_id = p.id) as audience,
               coalesce(json_agg(json_build_object(
                 'loginId', l.id, 'username', l.username, 'viewedAt', rv.viewed_at
               ) order by l.username) filter (where l.id is not null), '[]') as viewers
        from reports r
        join players p on p.id = r.player_id
        left join report_views rv on rv.report_id = r.id
        left join logins l on l.id = rv.login_id
        group by r.id, p.id
        order by r.published_at desc, r.id desc
      `;
      return res.status(200).json({
        reports: rows.map(function (r) {
          const viewers = typeof r.viewers === 'string' ? JSON.parse(r.viewers) : r.viewers;
          return {
            id: Number(r.id),
            title: r.title,
            publishedAt: r.published_at,
            sizeBytes: Number(r.size_bytes),
            playerId: Number(r.player_id),
            playerName: r.player_name,
            jersey: r.jersey,
            audience: Number(r.audience),
            viewers: (viewers || []).map(function (v) {
              return { loginId: Number(v.loginId), username: v.username, viewedAt: v.viewedAt };
            })
          };
        })
      });
    }

    const body = readBody(req);

    if (method === 'POST') {
      const playerId = validId(body.playerId);
      if (playerId === null) {
        return res.status(400).json({ error: 'Choose a player' });
      }
      const title = String(body.title == null ? '' : body.title).trim().slice(0, 200);
      if (!title) {
        return res.status(400).json({ error: 'Report title is required' });
      }

      const b64 = String(body.pdfBase64 == null ? '' : body.pdfBase64).replace(/^data:[^,]*,/, '');
      if (!b64) {
        return res.status(400).json({ error: 'No PDF supplied' });
      }

      let bytes;
      try {
        bytes = Buffer.from(b64, 'base64');
      } catch (e) {
        return res.status(400).json({ error: 'That file could not be read' });
      }
      if (!bytes.length) {
        return res.status(400).json({ error: 'That file is empty' });
      }
      if (bytes.length > MAX_PDF_BYTES) {
        return res.status(413).json({
          error: 'That PDF is ' + Math.round(bytes.length / 1024) +
                 ' KB. The limit is ' + Math.round(MAX_PDF_BYTES / 1024) + ' KB.'
        });
      }
      // Every real PDF starts with %PDF. Catches a stray Word doc or image.
      if (bytes.slice(0, 4).toString('latin1') !== '%PDF') {
        return res.status(400).json({ error: 'That file is not a PDF' });
      }

      const player = await sql`select id, name from players where id = ${playerId} limit 1`;
      if (player.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const inserted = await sql`
        insert into reports (player_id, title, pdf, published_at)
        values (${playerId}, ${title}, ${bytes}, now())
        returning id, title, published_at
      `;
      return res.status(201).json({
        report: {
          id: Number(inserted[0].id),
          title: inserted[0].title,
          publishedAt: inserted[0].published_at,
          playerId: playerId,
          playerName: player[0].name,
          sizeBytes: bytes.length
        }
      });
    }

    // DELETE - report_views rows go with it via cascade.
    const id = validId(body.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid report id' });
    }
    const removed = await sql`delete from reports where id = ${id} returning id, title`;
    if (removed.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.status(200).json({ ok: true, title: removed[0].title });
  } catch (err) {
    console.error('admin-reports error', err);
    return res.status(500).json({ error: 'Could not complete that action' });
  }
}