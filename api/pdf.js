import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

function passwordOk(supplied) {
  const expected = process.env.COACH_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(supplied ?? ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// pdf-lib has no text wrapping, so measure and break manually
function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? line + " " + word : word;
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!passwordOk(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const id = parseInt(req.body?.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id.' });
  }

  try {
    const rows = await sql`
      SELECT id, created_at, full_name, jersey, data
      FROM submissions WHERE id = ${id}
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const row = rows[0];
    const values = { ...row.data, fullName: row.full_name };

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

    page.drawText("PLAYER PROFILE", { x: MARGIN, y, size: 20, font: bold, color: RED });
    y -= 26;
    page.drawText(row.full_name, { x: MARGIN, y, size: 15, font: bold, color: DARK });
    y -= 16;
    page.drawText("Submitted " + new Date(row.created_at).toLocaleDateString("en-CA"), {
      x: MARGIN, y, size: 9, font: body, color: GREY
    });
    y -= 24;

    for (const [key, label] of LABELS) {
      const value = values[key];
      if (!value) continue;

      const lines = wrap(value, body, 11, width);
      room(14 + lines.length * 14 + 10);

      page.drawText(label, { x: MARGIN, y, size: 8.5, font: bold, color: GREY });
      y -= 13;

      for (const line of lines) {
        page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: DARK });
        y -= 14;
      }
      y -= 8;
    }

    const bytes = await pdf.save();
    const safe = row.full_name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="' + safe + '.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    console.error('pdf failed:', err);
    return res.status(500).json({ error: 'Could not build PDF.' });
  }
}
