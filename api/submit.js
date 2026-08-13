import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// Must match the field names bound in handbook.html
const FIELDS = [
  'fullName', 'jersey', 'birthday', 'position', 'height', 'weight',
  'shoots', 'catches', 'food', 'nhlTeam', 'nhlPlayer', 'otherSport',
  'subject', 'hypeSong', 'loveMost', 'teammate', 'improve'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};

    // Honeypot: real users never see this field. Bots fill it.
    // Return success so the bot does not retry.
    if (body.website) {
      return res.status(200).json({ ok: true });
    }

    const fullName = String(body.fullName ?? '').trim();
    if (!fullName) {
      return res.status(400).json({ error: 'Player name is required.' });
    }
    if (fullName.length > 120) {
      return res.status(400).json({ error: 'Player name is too long.' });
    }

    // Keep only known fields, trimmed and length-capped
    const data = {};
    for (const key of FIELDS) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) {
        data[key] = value.trim().slice(0, 2000);
      }
    }

    const rows = await sql`
      INSERT INTO submissions (full_name, jersey, data)
      VALUES (${fullName}, ${data.jersey ?? null}, ${JSON.stringify(data)}::jsonb)
      RETURNING id
    `;

    return res.status(200).json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('submit failed:', err);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}
