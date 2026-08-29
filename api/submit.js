// api/submit.js - player profile form. Now behind login so submissions
// auto-link to a player. For multi-player logins (twins) the typed full name
// is the ground truth: parents submit for both kids back-to-back in one
// session, so the client's playerId hint can be stale from the previous
// child. The hint is only a fallback when the name matches nobody, and it is
// still verified against the login's own players before being stored.
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion } from '../lib/auth.js';
const sql = neon(process.env.DATABASE_URL);
// Must match the field names bound in handbook.html
const FIELDS = [
  'fullName', 'jersey', 'birthday', 'position', 'height', 'weight',
  'shoots', 'catches', 'food', 'nhlTeam', 'nhlPlayer', 'otherSport',
  'subject', 'hypeSong', 'loveMost', 'teammate', 'improve'
];
// Same normalization rule as the duplicate-name detector: strip apostrophes
// BEFORE collapsing punctuation, so O'Brien and OBrien produce the same key.
function normalizeName(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// Whole-word containment: every token of one name appears in the other.
// Avoids the indexOf substring bug (Jack Li vs Jackson Lightfoot).
function tokensContained(shorter, longer) {
  return shorter.every(function (t) { return longer.indexOf(t) !== -1; });
}
function matchPlayerByName(fullName, candidates) {
  const submitted = normalizeName(fullName);
  if (!submitted) return null;
  // Pass 1: exact normalized match
  const exact = candidates.filter(function (p) {
    return normalizeName(p.name) === submitted;
  });
  if (exact.length === 1) return Number(exact[0].id);
  if (exact.length > 1) return null; // ambiguous
  // Pass 2: whole-word containment either direction
  const submittedTokens = submitted.split(' ');
  const partial = candidates.filter(function (p) {
    const nameTokens = normalizeName(p.name).split(' ');
    return tokensContained(nameTokens, submittedTokens) ||
           tokensContained(submittedTokens, nameTokens);
  });
  if (partial.length === 1) return Number(partial[0].id);
  return null; // zero or ambiguous - caller decides what to do
}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    // Honeypot: real users never see this field. Bots fill it.
    if (body.website) {
      return res.status(200).json({ ok: true });
    }
    const fullName = String(body.fullName == null ? '' : body.fullName).trim();
    if (!fullName) {
      return res.status(400).json({ error: 'Player name is required.' });
    }
    if (fullName.length > 120) {
      return res.status(400).json({ error: 'Player name is too long.' });
    }
    const loginRows = await sql`
      select id, token_version from logins where id = ${session.lid} limit 1
    `;
    if (loginRows.length === 0) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    if (!checkVersion(session, loginRows[0])) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    // Players this login is allowed to submit for. This list - not the request
    // body - decides what player_id can be written.
    const mine = await sql`
      select p.id, p.name from players p
      join login_players lp on lp.player_id = p.id and lp.login_id = ${session.lid}
      order by p.name
    `;
    const allowed = mine.map(function (p) { return Number(p.id); });
    let playerId = null;
    if (allowed.length === 1) {
      // Only one child - name and hint are both irrelevant.
      playerId = allowed[0];
    } else if (allowed.length > 1) {
      // NAME FIRST. Twins are submitted back-to-back in the same session, so
      // the picker hint can be left over from the previous child. The typed
      // name decides; the hint only breaks a tie when the name matches nobody.
      playerId = matchPlayerByName(fullName, mine);
      if (playerId === null) {
        const hint = Number(body.playerId);
        if (Number.isInteger(hint) && allowed.indexOf(hint) !== -1) {
          playerId = hint;
        } else {
          return res.status(400).json({
            error: 'Please enter the player\'s full name exactly as it appears on the roster.'
          });
        }
      }
    }
    // allowed.length === 0 leaves playerId null for the coach to link manually.
    // Keep only known fields, trimmed and length-capped
    const data = {};
    for (const key of FIELDS) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) {
        data[key] = value.trim().slice(0, 2000);
      }
    }
    const rows = await sql`
      insert into submissions (full_name, jersey, data, player_id)
      values (${fullName}, ${data.jersey == null ? null : data.jersey}, ${JSON.stringify(data)}::jsonb, ${playerId})
      returning id
    `;
    return res.status(200).json({ ok: true, id: Number(rows[0].id), playerId: playerId });
  } catch (err) {
    console.error('submit failed:', err);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}
