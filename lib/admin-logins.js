// api/admin-logins.js - coach-only management of parent logins.
// GET     list logins with linked players
// POST    create   { username, playerIds: [] }        -> returns tempPassword ONCE
// PATCH   reset    { id, action: "reset" }            -> returns tempPassword ONCE
// PATCH   assign   { id, action: "assign", playerIds: [] }
// DELETE  remove   { id }
import { neon } from '@neondatabase/serverless';
import { requireSession, checkVersion, hashPassword, makeTempPassword } from './auth.js';

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

function validId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

// Usernames are stored lowercase because api/login.js lowercases on lookup.
function cleanUsername(v) {
  return String(v == null ? '' : v).trim().toLowerCase().slice(0, 60);
}

function cleanPlayerIds(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    const id = validId(raw);
    if (id !== null && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

// Replace all links for one login. Not a transaction: neon http mode runs each
// statement separately. Worst case is a login with no players, which the coach
// can see and fix - acceptable versus the complexity of a pooled transaction.
async function setPlayers(loginId, playerIds) {
  await sql`delete from login_players where login_id = ${loginId}`;
  for (const pid of playerIds) {
    await sql`
      insert into login_players (login_id, player_id) values (${loginId}, ${pid})
      on conflict do nothing
    `;
  }
}

export default async function handler(req, res) {
  const method = req.method;
  if (['GET', 'POST', 'PATCH', 'DELETE'].indexOf(method) === -1) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await guard(req, res);
  if (!session) return;

  try {
    if (method === 'GET') {
      const rows = await sql`
        select l.id, l.username, l.must_change, l.is_coach, l.created_at,
               coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'jersey', p.jersey)
                 order by p.name) filter (where p.id is not null), '[]') as players
        from logins l
        left join login_players lp on lp.login_id = l.id
        left join players p on p.id = lp.player_id
        group by l.id, l.username, l.must_change, l.is_coach, l.created_at
        order by l.is_coach desc, l.username
      `;
      return res.status(200).json({
        logins: rows.map(function (l) {
          const players = typeof l.players === 'string' ? JSON.parse(l.players) : l.players;
          return {
            id: Number(l.id),
            username: l.username,
            mustChange: l.must_change === true,
            isCoach: l.is_coach === true,
            createdAt: l.created_at,
            isSelf: Number(l.id) === Number(session.lid),
            players: (players || []).map(function (p) {
              return { id: Number(p.id), name: p.name, jersey: p.jersey };
            })
          };
        })
      });
    }

    const body = readBody(req);

    if (method === 'POST') {
      const username = cleanUsername(body.username);
      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }
      if (!/^[a-z0-9._-]+$/.test(username)) {
        return res.status(400).json({ error: 'Use only letters, numbers, dots, dashes and underscores' });
      }
      const playerIds = cleanPlayerIds(body.playerIds);

      const existing = await sql`
        select id from logins where username = ${username} limit 1
      `;
      if (existing.length > 0) {
        return res.status(409).json({ error: 'That username is already taken' });
      }

      const tempPassword = makeTempPassword();
      const hash = await hashPassword(tempPassword);

      // is_coach is deliberately hard-coded false. Promoting a coach is a
      // deliberate database action, not a button in the portal.
      const inserted = await sql`
        insert into logins (username, password_hash, must_change, token_version, is_coach, created_at)
        values (${username}, ${hash}, true, 1, false, now())
        returning id, username
      `;
      const newId = Number(inserted[0].id);
      if (playerIds.length) await setPlayers(newId, playerIds);

      // tempPassword is returned exactly once and never stored in plaintext.
      return res.status(201).json({
        login: { id: newId, username: inserted[0].username },
        tempPassword: tempPassword
      });
    }

    if (method === 'PATCH') {
      const id = validId(body.id);
      if (id === null) {
        return res.status(400).json({ error: 'Invalid login id' });
      }
      const target = await sql`
        select id, username, token_version, is_coach from logins where id = ${id} limit 1
      `;
      if (target.length === 0) {
        return res.status(404).json({ error: 'Login not found' });
      }

      if (body.action === 'reset') {
        const tempPassword = makeTempPassword();
        const hash = await hashPassword(tempPassword);
        const nextVersion = Number(target[0].token_version) + 1;
        // Bumping token_version signs this person out everywhere immediately.
        await sql`
          update logins
          set password_hash = ${hash}, must_change = true, token_version = ${nextVersion}
          where id = ${id}
        `;
        return res.status(200).json({
          login: { id: id, username: target[0].username },
          tempPassword: tempPassword,
          signedOutSelf: Number(id) === Number(session.lid)
        });
      }

      if (body.action === 'assign') {
        const playerIds = cleanPlayerIds(body.playerIds);
        await setPlayers(id, playerIds);
        return res.status(200).json({ ok: true, playerIds: playerIds });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // DELETE
    const id = validId(body.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid login id' });
    }
    if (Number(id) === Number(session.lid)) {
      return res.status(400).json({ error: 'You cannot delete the login you are signed in with' });
    }
    const removed = await sql`
      delete from logins where id = ${id} returning id, username
    `;
    if (removed.length === 0) {
      return res.status(404).json({ error: 'Login not found' });
    }
    return res.status(200).json({ ok: true, username: removed[0].username });
  } catch (err) {
    console.error('admin-logins error', err);
    return res.status(500).json({ error: 'Could not complete that action' });
  }
}