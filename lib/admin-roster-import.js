// api/admin-roster-import.js - coach-only bulk roster paste.
// POST { mode: "preview", text }  -> parsed rows, no writes
// POST { mode: "commit",  text }  -> inserts new players, skips existing
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from './auth.js';

const sql = neon(process.env.DATABASE_URL);

const MAX_LINES = 200;
const MAX_TEXT = 20000;

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

// Normalised form used only for duplicate detection, never stored.
function normalize(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’´`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Accepts "Ava Smith", "Ben Smith, 19", "Charlie OBrien<TAB>7".
// Splits jersey on comma or tab so a pasted Excel column and hand-typed
// text both work. Excel wraps fields containing commas in quotes.
function parseLine(raw) {
  let line = String(raw).replace(/\r/g, '').trim();
  if (!line) return null;

  let name = line;
  let jersey = null;

  const sep = line.search(/[,\t]/);
  if (sep !== -1) {
    name = line.slice(0, sep).trim();
    jersey = line.slice(sep + 1).replace(/[,\t]/g, ' ').trim();
  }

  // Strip Excel's surrounding quotes and un-double any inner ones.
  if (name.length > 1 && name.charAt(0) === '"' && name.charAt(name.length - 1) === '"') {
    name = name.slice(1, -1).replace(/""/g, '"');
  }

  name = name.replace(/\s{2,}/g, ' ').trim().slice(0, 120);
  if (!name) return null;

  if (jersey) {
    jersey = jersey.replace(/^["']|["']$/g, '').trim().slice(0, 10);
    if (!jersey) jersey = null;
  }

  return { name: name, jersey: jersey };
}

function parseText(text) {
  const lines = String(text == null ? '' : text).slice(0, MAX_TEXT).split(/\n/);
  const parsed = [];
  const seen = Object.create(null);
  let duplicateInPaste = 0;

  for (const line of lines) {
    if (parsed.length >= MAX_LINES) break;
    const row = parseLine(line);
    if (!row) continue;
    const key = normalize(row.name);
    if (!key) continue;
    if (seen[key]) { duplicateInPaste++; continue; }
    seen[key] = true;
    parsed.push(row);
  }
  return { parsed: parsed, duplicateInPaste: duplicateInPaste };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await guard(req, res);
  if (!session) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const mode = body.mode === 'commit' ? 'commit' : 'preview';

    const result = parseText(body.text);
    if (!result.parsed.length) {
      return res.status(400).json({ error: 'No player names found in that text' });
    }

    const existing = await sql`select id, name, jersey from players`;
    const byKey = Object.create(null);
    for (const p of existing) byKey[normalize(p.name)] = p;

    const toCreate = [];
    const alreadyPresent = [];
    for (const row of result.parsed) {
      const match = byKey[normalize(row.name)];
      if (match) {
        alreadyPresent.push({ name: row.name, existingId: Number(match.id) });
      } else {
        toCreate.push(row);
      }
    }

    if (mode === 'preview') {
      return res.status(200).json({
        mode: 'preview',
        toCreate: toCreate,
        alreadyPresent: alreadyPresent,
        duplicateInPaste: result.duplicateInPaste,
        parsedCount: result.parsed.length
      });
    }

    // Commit. Inserted one at a time - neon http mode has no transaction, and a
    // partial import is recoverable by simply pasting the same list again.
    const created = [];
    for (const row of toCreate) {
      const ins = await sql`
        insert into players (name, jersey, created_at)
        values (${row.name}, ${row.jersey}, now())
        returning id, name, jersey
      `;
      created.push({ id: Number(ins[0].id), name: ins[0].name, jersey: ins[0].jersey });
    }

    return res.status(200).json({
      mode: 'commit',
      created: created,
      createdCount: created.length,
      skippedCount: alreadyPresent.length,
      duplicateInPaste: result.duplicateInPaste
    });
  } catch (err) {
    console.error('admin-roster-import error', err);
    return res.status(500).json({ error: 'Could not import the roster' });
  }
}