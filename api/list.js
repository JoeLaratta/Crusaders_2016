import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';

const sql = neon(process.env.DATABASE_URL);

// Constant-time comparison so the password cannot be guessed
// character-by-character from response timing.
function passwordOk(supplied) {
  const expected = process.env.COACH_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(supplied ?? ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!passwordOk(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  try {
    const rows = await sql`
      SELECT id, created_at, full_name, jersey
      FROM submissions
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ ok: true, rows });
  } catch (err) {
    console.error('list failed:', err);
    return res.status(500).json({ error: 'Could not load submissions.' });
  }
}
