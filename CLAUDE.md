# Crusaders Handbook Site

Static site for the 2016 Crusaders program manual, plus a player-profile
form that parents submit and coaching staff download as PDFs.

Live: https://crusaders-2016.vercel.app/
Vercel project `crusaders-2016`, team Bear Valley Solutions (Hobby).
Repo: https://github.com/JoeLaratta/Crusaders_2016 (branch `main`).
The repo is NOT connected to Vercel - deploys are manual.

## Files

- `index.html`   - intro animation, front door at `/`
- `handbook.html`- program manual, 8 sections, one long scroll
- `coach.html`   - password-gated roster + PDF downloads
- `favicon.png`  - tab icon
- `api/submit.js`- POST, public. Inserts a submission.
- `api/list.js`  - POST, password. Returns the roster.
- `api/pdf.js`   - POST, password. Builds a PDF with pdf-lib.

## CRITICAL: how handbook.html and index.html are built

The visible page is NOT plain HTML. Both files contain the real document
as an **escaped JSON string** inside a `<script>` block, rendered by a
small custom runtime. Inside that string:

- quotes are `\"`, not `"`
- `</script>` is written `<\u002Fscript>`, `</div>` is `<\u002Fdiv>`, etc.
- newlines are the two characters `\n`, NEVER a real line break

**Inserting a literal newline breaks the JSON parse and the whole page
dies** with "Error unpacking: Bad control character in string literal."
This has happened. Always verify after editing:

```powershell
"Lines before: $((Get-Content handbook.html.bak).Count)"
"Lines after:  $((Get-Content handbook.html).Count)"
```

The counts MUST match (386 for handbook.html). Back up first, edit with
`.Replace()` on exact strings, confirm the match count is 1 before writing.

### Template syntax

- `{{ f.fieldName }}` - value binding
- `sc-camel-on-change="{{ set.fieldName }}"` - input handler
- `sc-camel-on-click="{{ handlerName }}"` - button handler
- `style-hover="..."` - hover styles
- Interpolation works inside `style` attributes, e.g. `color:{{ submitColor }}`
- `class="noprint"` hides an element when printing

Handlers and derived values live in the object returned near the very end
of the file (`printForm`, `clearForm`, `submitForm`, `savedNote`,
`submitNote`, `submitColor`). `this.setState({...})` MERGES - it does not
replace state, so form values survive a partial update.

## Form

17 fields, all bound to `f`: fullName, jersey, birthday, position, height,
weight, shoots, catches, food, nhlTeam, nhlPlayer, otherSport, subject,
hypeSong, loveMost, teammate, improve.

Form state persists to localStorage. Two paths for parents:
- **Print / save as PDF** - `window.print()`, unchanged, works offline
- **Submit to coach** - POSTs `f` to `/api/submit`

## Database

Neon Postgres via Vercel Marketplace (`neon-lime-ladder`, free tier).
Connection string is `DATABASE_URL`, injected automatically.
Use `@neondatabase/serverless` - `@vercel/postgres` is deprecated.

```sql
CREATE TABLE submissions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  full_name   TEXT NOT NULL,
  jersey      TEXT,
  data        JSONB NOT NULL
);
```

Only `full_name` and `jersey` are broken out (the roster sorts on them).
Everything else lives in `data` as JSONB, so adding or renaming a form
field needs NO migration - only the LABELS array in `api/pdf.js`.

The Vercel Query editor runs ONE statement per execution and defaults to
read-only. Toggle read-only off for any write.

## Environment variables

- `DATABASE_URL` and friends - injected by Neon
- `COACH_PASSWORD` - set manually, marked Sensitive, Production + Preview

Password checks use `timingSafeEqual`, and the password travels in the
POST body (never a query string, so it stays out of logs and history).
Env var changes need a redeploy to take effect.

## Deploy

```powershell
npx vercel --prod
git add .
git commit -m "message"
git push
```

Deploy first, then push, so the live site is never behind GitHub.
Framework preset: Other. Build command and output directory: blank.

## Gotchas

- **OneDrive**: the folder is synced. Repeated writes to a 1.3 MB file
  cause "Access is denied" and phantom "does not exist" errors. Pause
  syncing before a run of edits.
- **PowerShell here-strings** are fragile on paste - `'@` must start its
  own line. A corrupted `package.json` looked like an npm bug but was a
  paste artifact.
- **npm install** must run before deploying if dependencies changed.
- `node_modules` and `.vercel` are gitignored. Keep it that way.

## Known gaps (accepted, not bugs)

- `/api/submit` is unauthenticated. No honeypot yet - add one if junk
  rows appear.
- No duplicate protection. Double-clicking Submit creates two rows;
  delete extras in the SQL editor.
- No delete button on the coach page - deliberate, since accidental
  deletion has no undo.
- Neon scales to zero when idle, so the first request after a quiet
  spell takes an extra second or two.
- Both HTML files are ~1.3 MB because fonts and the logo are inlined.
  Fine for now; extracting them would let the browser cache across pages.
