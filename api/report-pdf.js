// api/report-pdf.js - streams one progress report PDF to an authorized login.
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

// Strip characters that would break the Content-Disposition header.
function safeFilename(title, playerName) {
  const base = (playerName || 'report') + ' - ' + (title || 'progress report');
  return base.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 80) + '.pdf';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const reportId = Number(req.query && req.query.id);
  // Upper bound matters: Number("9".repeat(30)) is 1e30 and passes isInteger,
  // which would overflow bigint in Postgres. Values above MAX_SAFE_INTEGER also
  // round silently and could resolve to the wrong report id.
  if (!Number.isInteger(reportId) || reportId <= 0 || reportId > Number.MAX_SAFE_INTEGER) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

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

    // Ownership is proven inside the SAME query that reads the bytes, so there
    // is no window where the pdf is loaded before the check runs.
    const rows = await sql`
      select r.id, r.title, r.pdf, p.name as player_name
      from reports r
      join players p on p.id = r.player_id
      join login_players lp on lp.player_id = p.id and lp.login_id = ${session.lid}
      where r.id = ${reportId}
      limit 1
    `;

    // Same 404 whether the report does not exist or is not theirs - never
    // confirm that another family's report id is real.
    if (rows.length === 0 || !rows[0].pdf) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const bytes = Buffer.isBuffer(rows[0].pdf) ? rows[0].pdf : Buffer.from(rows[0].pdf);

    // Record the FIRST view only. Never block the download on this.
    try {
      await sql`
        insert into report_views (report_id, login_id, viewed_at)
        values (${reportId}, ${session.lid}, now())
        on conflict (report_id, login_id) do nothing
      `;
    } catch (logErr) {
      console.error('report view log failed', logErr);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition',
      'inline; filename="' + safeFilename(rows[0].title, rows[0].player_name) + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(bytes);
  } catch (err) {
    console.error('report-pdf error', err);
    return res.status(500).json({ error: 'Could not load report' });
  }
}