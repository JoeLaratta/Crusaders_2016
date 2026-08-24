// api/admin.js - single entry point for all coach-only admin operations.
// Vercel Hobby caps a deployment at 12 serverless functions, and every file in
// /api counts as one. The four admin handlers therefore live in /lib (which is
// NOT counted) and are dispatched from here by ?resource=.
//
//   /api/admin?resource=players   -> lib/admin-players.js
//   /api/admin?resource=logins    -> lib/admin-logins.js
//   /api/admin?resource=reports   -> lib/admin-reports.js
//   /api/admin?resource=roster    -> lib/admin-roster-import.js
//
// Each handler keeps its own auth guard, so this file adds no security surface.
import players from '../lib/admin-players.js';
import logins from '../lib/admin-logins.js';
import reports from '../lib/admin-reports.js';
import roster from '../lib/admin-roster-import.js';
import { requireSession } from '../lib/auth.js';

const HANDLERS = {
  players: players,
  logins: logins,
  reports: reports,
  roster: roster
};

export default async function handler(req, res) {
  // Authenticate BEFORE looking at the resource name. Checking the map first
  // leaks which resources exist: an unknown one 404s while a real one 401s.
  const session = await requireSession(req, res, { requireCoach: true });
  if (!session) return;

  const resource = String((req.query && req.query.resource) || '');
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, resource)) {
    return res.status(404).json({ error: 'Unknown admin resource' });
  }
  return HANDLERS[resource](req, res);
}