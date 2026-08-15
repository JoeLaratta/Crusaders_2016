// api/pdf.js - coach-only profile PDF. Converted from COACH_PASSWORD to session auth.
import { neon } from '@neondatabase/serverless';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { requireSession, checkVersion } from '../lib/auth.js';

const sql = neon(process.env.DATABASE_URL);

const LABELS = [
  ['fullName', 'Player name'],
  ['jersey', 'Jersey number'],
  ['birthday', 'Birthday'],
  ['position', 'Position'],
  ['height', 'Height'],
  ['weight', 'Weight'],
  ['shoots', 'Shoots'],
  ['catches', 'Catches'],
  ['food', 'Favourite food'],
  ['nhlTeam', 'Favourite NHL team'],
  ['nhlPlayer', 'Favourite NHL player'],
  ['otherSport', 'Other sport'],
  ['subject', 'Favourite subject in school'],
  ['hypeSong', 'Hype song'],
  ['loveMost', 'What do you love most about hockey?'],
  ['teammate', 'What does being a great teammate mean to you?'],
  ['improve', 'What do you want to improve this season?']
];

// Helvetica uses WinAnsi (CP1252). drawText THROWS on anything it cannot encode,
// so one emoji from a phone keyboard would 500 the whole PDF. Accents, em dashes
// and smart quotes are all valid CP1252 and pass through untouched.
const WINANSI_EXTRA = new Set([0x20AC,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,
  0x0160,0x2039,0x0152,0x017D,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,
  0x0161,0x203A,0x0153,0x017E,0x0178]);

function winAnsiSafe(text) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13) { out += ch; continue; }
    if (c >= 0x20 && c <= 0x7E) { out += ch; continue; }
    if (c >= 0xA0 && c <= 0xFF) { out += ch; continue; }
    if (WINANSI_EXTRA.has(c)) { out += ch; continue; }
  }
  return out;
}

// pdf-lib has no text wrapping, so measure and break manually.
function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, { requireCoach: true });
  if (!session) return;

  const id = Number(req.query && req.query.id);
  if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) {
    return res.status(400).json({ error: 'Invalid id.' });
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

    const rows = await sql`
      select id, created_at, full_name, jersey, data
      from submissions where id = ${id}
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const row = rows[0];
    const fullName = winAnsiSafe(row.full_name || 'Unnamed player');
    const values = Object.assign({}, row.data, { fullName: row.full_name });

    const pdf = await PDFDocument.create();
    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const RED = rgb(0.702, 0.086, 0.110);
    const DARK = rgb(0.071, 0.094, 0.129);
    const GREY = rgb(0.478, 0.447, 0.400);

    const MARGIN = 56;
    let page = pdf.addPage([612, 792]);
    let y = 792 - MARGIN;
    const width = 612 - MARGIN * 2;

    function room(needed) {
      if (y - needed < MARGIN) {
        page = pdf.addPage([612, 792]);
        y = 792 - MARGIN;
      }
    }

    page.drawText('PLAYER PROFILE', { x: MARGIN, y, size: 20, font: bold, color: RED });
    y -= 26;
    page.drawText(fullName, { x: MARGIN, y, size: 15, font: bold, color: DARK });
    y -= 16;
    const when = row.created_at ? new Date(row.created_at) : null;
    const whenText = when && !isNaN(when.getTime())
      ? 'Submitted ' + when.toLocaleDateString('en-CA') : '';
    if (whenText) {
      page.drawText(whenText, { x: MARGIN, y, size: 9, font: body, color: GREY });
    }
    y -= 24;

    for (const pair of LABELS) {
      const clean = winAnsiSafe(values[pair[0]]).trim();
      if (!clean) continue;

      const lines = wrap(clean, body, 11, width);
      room(27);
      page.drawText(pair[1], { x: MARGIN, y, size: 8.5, font: bold, color: GREY });
      y -= 13;

      // Break pages per line, so a long answer never runs off the bottom.
      for (const line of lines) {
        room(14);
        page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: DARK });
        y -= 14;
      }
      y -= 8;
    }

    const bytes = await pdf.save();
    const safe = (fullName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')) || 'profile';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '.pdf"');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    console.error('pdf failed:', err);
    return res.status(500).json({ error: 'Could not build PDF.' });
  }
}