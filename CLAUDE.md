# CLAUDE.md - 2016 Crusaders site

Youth hockey program site for client Steve, built by Bear Valley Solutions (Joe).

- Local: `C:\Users\glara\OneDrive\Desktop\Crusaders_Plan\Hockey Season Handbook Updates\deploy`
- Live: https://crusaders-2016.vercel.app/
- Vercel project `crusaders-2016`, team Bear Valley Solutions (Hobby), user `joe-6694`
- Repo: `JoeLaratta/Crusaders_2016`, branch `main`, NOT connected to Vercel - deploys are manual
- Deploy: `npx vercel --prod --scope bear-valley-solutions` FIRST, then `git add . / commit / push`

**The `--scope` flag is required.** Without it the CLI returns "Not authorized" even when
`npx vercel whoami` shows the correct user and active team. This has happened twice.

## How Joe wants to work

- One command at a time. Wait for the result before sending the next.
- If output needs pasting back, say so immediately after that command, not at the bottom.
- Do not run ahead - he should never have to scroll back through earlier messages.
- Concise, copy-paste ready, senior-dev tone. Flag risks and edge cases.
- Always include the relevant URLs alongside browser test instructions.
- **Never put triple-backtick fences inside a PowerShell here-string written to chat.**
  They terminate the outer markdown fence and shatter one copy box into eight. For files
  containing fenced markdown, build the file and deliver it as a download instead.
- SQL goes in the Vercel Query editor in the browser, NOT in PowerShell. Say which.

---

## CRITICAL: handbook.html and index.html are NOT plain HTML

Both contain the real document as an **escaped JSON string** inside a `<script>` block,
rendered by a custom `sc-camel` runtime.

- quotes are `\"`, `</div>` is written `<\u002Fdiv>`, `</script>` is `<\u002Fscript>`
- newlines are the two characters `\n` - NEVER a real line break
- A literal newline breaks the JSON parse and kills the whole page with
  "Error unpacking: Bad control character in string literal." This has happened twice.

**Edit procedure, every time:**

1. `Copy-Item handbook.html handbook.html.bakN`
2. Build exact `$old`/`$new` strings, confirm match count is exactly 1 BEFORE writing
3. Keep all replacement content on ONE line - no real newlines inside the JSON
4. Verify the line count immediately after
5. Only then deploy

**Line count baselines (as of the last session):**

- `handbook.html` = **497 lines**. The escaped JSON is 386 of those; the rest is a
  trailing plain-JS `<script>` block appended after the runtime's `</script>`.
  Edits INSIDE the JSON must leave the count unchanged. Appending to the trailing
  script legitimately grows it.
- `index.html` = **385 lines**, all escaped JSON. Any edit must leave it at 385.

**Template syntax:** `{{ f.field }}` bindings, `sc-camel-on-change="{{ set.field }}"`,
`sc-camel-on-click="{{ handler }}"`, `style-hover="..."`, `class="noprint"`.
Interpolation works inside `style` attributes. `this.setState({...})` MERGES.
Handlers live in the object returned at the very end of the file.

`login.html`, `reports.html` and `coach.html` are ordinary HTML - none of this applies.

### The trailing script block in handbook.html

Sits AFTER the runtime's `</script>`, outside the escaped string. Plain JS, safe to edit
normally. It drives four things:

- `#cruPortalLink` - markup default is `Reports` / `/reports.html`. Flipped to
  `Coach portal` / `/coach.html` only when `/api/me` confirms `isCoach`. Defaulting to
  the parent view means a failed fetch still leaves a working link.
- `#cruLogoutLink` - `Sign out`. Clears the saved form draft, POSTs `/api/logout`,
  redirects. The `href` is a real fallback if the listener never binds.
- `#cruPlayerPick` - the player picker, injected ONLY when the login covers 2+ players.
- localStorage owner check - see below.

**The runtime re-renders on section changes and wipes injected DOM.** The portal link and
the picker both use a `MutationObserver` to repaint; logout uses a delegated listener on
`document`. Do NOT replace these with direct `addEventListener` on the element - it works
until the first nav click, then silently stops.

### The form draft is scoped to the login

The profile form autosaves to `localStorage` under `crusaders-player-form-v1`, a single
browser-wide key with no notion of who is signed in. Without scoping, a second parent on
the same browser sees the first parent's draft - and could submit it under the wrong name.

`crusaders-form-owner` stores the current `loginId`. On load, if it differs from
`/api/me`, the draft is cleared and the page reloads (the runtime already read the draft
into state on mount, so clearing alone is not enough). A `null` previous owner is NOT
treated as a mismatch - that is a legitimate pre-login draft and wiping it would destroy
work someone just did.

Sign-out also clears both keys. Accepted trade-off: a parent who signs out mid-form loses
the draft. Privacy beat convenience because the form is a one-time seasonal task.

---

## Environment gotchas

- **OneDrive**: folder is synced. Pause syncing before repeated writes to the 1.3 MB
  files. Symptom is "Access is denied" AND "does not exist" for the same path in one
  command.
- **All files use LF line endings.** Patches must use backtick-n, not backtick-r
  backtick-n. A zero-match `.Replace()` fails silently and still reports success.
- **PS5 here-strings**: the closing terminator must start its own line. If the prompt
  stays at `>>` the paste was mangled - Ctrl+C and use another method. Never put a write
  command and a read command on the same pasted line; they merge and PowerShell throws
  "Unexpected token". This silently skipped a file write once.
- **PS5 encoding**: `Set-Content -Encoding utf8` writes a BOM and reads as ANSI.

  Correct write:

      [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))

  Correct read:

      [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)

  Plain `Get-Content` misreads em dashes as mojibake - the FILE is usually fine, the
  reader is wrong. Verify with ReadAllText before believing a mojibake report.
- **Verification greps**: strip comment lines first or your own comment text trips the
  check. This wasted several round trips.
- **PowerShell apostrophes**: inside a single-quoted string, a literal apostrophe must be
  doubled (`''Oswald''`). Backticks must be doubled too, and `$` escaped as backtick-$.
- **Vercel Query editor**: ONE statement per Run, Read-only toggle defaults ON.
- **PS5 `Invoke-WebRequest -MaximumRedirection 0`** throws on 3xx and corrupts the
  exception object. Use `System.Net.Http.HttpClient` with `AllowAutoRedirect = $false`.

---

## CRITICAL: the 12-function limit

**Vercel Hobby allows a maximum of 12 Serverless Functions per deployment, and every file
in `/api` counts as one.** Exceeding it fails the deploy outright.

The project sits at **10**. Four admin handlers therefore live in `/lib` (NOT counted) and
are dispatched by a single `api/admin.js` via `?resource=`. **Do not move them back into
`/api`, and think before adding a new route** - there are two slots left.

---

## Auth architecture

The whole site sits behind a login. One login per parent, many-to-many with players.

### The Edge/Node split - do not collapse these two files

`middleware.js` runs on the Vercel **Edge runtime**, which has no `node:crypto` and no
`Buffer`. Therefore:

- **`lib/token.js`** - ISOMORPHIC. Web Crypto (`crypto.subtle`) plus `atob`/`btoa` only.
  Imported by middleware AND lib/auth.js. Adding `Buffer` breaks the whole site.
- **`lib/auth.js`** - NODE ONLY. scrypt hashing, temp passwords, `requireSession`.
  Re-exports everything from token.js so API routes import one file.
  NEVER import this from middleware.js.

`createToken` / `readToken` are **async** (Web Crypto is promise-based). Forgetting
`await` yields a truthy Promise that passes an `if` check - i.e. it fails open.

### Session model

- Signed HMAC-SHA256 token: base64url payload, dot, signature
- Payload: `{ lid, ver, mc, coach, exp }` - login id, token_version, must_change, is_coach
- Cookie `cru_session`: HttpOnly, Secure, SameSite=Strict, **no Max-Age** (dies on browser
  close). 12-hour hard cap in `exp`.
- SameSite=Strict means the cookie is NOT sent when arriving from an external link (email,
  SMS). First click looks logged out. Accepted trade-off.

### Revocation

`token_version` is checked **against the database** by every route that returns data.
Middleware CANNOT check it (no DB on Edge), so a revoked session can still fetch static
HTML for up to 12h but gets nothing from any API. Bumping `token_version` signs that login
out everywhere.

### The requireSession convention

Every protected route starts with:

    const session = await requireSession(req, res, { requireCoach: true });
    if (!session) return;

It writes the 401/403 itself and returns null. Options:

- `allowMustChange: true` - ONLY for change-password and logout
- `requireCoach: true` - coach-only endpoints

Then re-check `token_version` against the DB with `checkVersion(session, rows[0])`.

**Authenticate BEFORE branching on anything in the request.** `api/admin.js` originally
looked up the resource name first, so an unknown resource 404'd while a real one 401'd -
letting an unauthenticated caller enumerate valid resource names. Fixed by moving the
session check above the lookup.

### must_change flow

New logins get a temp password and `must_change = true`. The token carries `mc: true` and
is rejected by every route except change-password and logout. Middleware sends those users
to /login.html, which detects the 403 from /api/me and shows the change-password panel.

---

## Navigation model

**The handbook is the home page for everyone.** Login lands there regardless of role.

- `index.html` intro animation - both links go to `/login.html`
- Parent: handbook, `Reports` button, `/reports.html`, "Return to the handbook"
- Coach: handbook, `Coach portal` button, `/coach.html`, "Return to the handbook"
- Both: `Download handbook` (gated PDF) and `Sign out` in the handbook nav

`login.html`'s `go()` sends everyone to `/handbook.html`; it keeps its unused `isCoach`
parameter so the two call sites did not need editing. Middleware redirects a non-coach who
requests `/coach.html` to `/handbook.html`.

---

## Files

### lib/ (NOT serverless functions)

- `token.js` - isomorphic sign/verify/cookie helpers (Edge-safe)
- `auth.js` - Node-only hashing plus requireSession/checkVersion
- `admin-players.js` - roster CRUD plus submission linking
- `admin-logins.js` - parent login management
- `admin-reports.js` - report upload / status / delete
- `admin-roster-import.js` - bulk roster paste

### middleware.js

Gates all static routes. Public: `/`, `/index.html`, `/login.html`, `/favicon.ico`,
`/robots.txt`, and an explicit extension allowlist (css/js/png/woff/etc).
The allowlist is deliberately NOT a wildcard - that keeps `/package.json`, `/CLAUDE.md`
and the handbook `.pdf` gated.
`/api/*` is EXCLUDED from the matcher: routes self-guard, and intercepting them would
return HTML redirects to fetch() callers.
**Fails closed** - any thrown error redirects to login rather than serving the file.

Requires `@vercel/functions` for `next()`. Non-Next projects cannot use
`NextResponse.next()`, and a bare `return undefined` is not the current contract.

### api/ (10 functions - the limit is 12)

| Route | Method | Auth | Notes |
|---|---|---|---|
| `login.js` | POST | public | Timing-safe: dummy hash on unknown user, ~0.4ms delta |
| `logout.js` | POST | none | Works with broken/absent token, touches no DB |
| `change-password.js` | POST | mc allowed | Requires current pw, bumps token_version, issues fresh cookie |
| `me.js` | GET | session | Identity plus linked players |
| `reports.js` | GET | session | List; does NOT select r.pdf (blobs) |
| `report-pdf.js` | GET ?id= | session | Ownership proven in the same query as the bytes |
| `submit.js` | POST | session | Profile form; auto-links player_id |
| `list.js` | GET | coach | Submissions list, camelCase |
| `pdf.js` | GET ?id= | coach | Profile PDF via pdf-lib |
| `admin.js` | varies | coach | Dispatcher to lib/admin-*.js by ?resource= |

### api/admin.js dispatcher

    /api/admin?resource=players   GET, POST, PATCH, PUT
    /api/admin?resource=logins    GET, POST, PATCH, DELETE
    /api/admin?resource=reports   GET, POST, DELETE
    /api/admin?resource=roster    POST (mode: preview | commit)

Uses `Object.prototype.hasOwnProperty.call` for the lookup - a bare `HANDLERS[resource]`
would let `?resource=constructor` return a function and invoke it.

`resource=players` PUT links a submission to a player: `{ submissionId, playerId }`,
playerId null or empty string to unlink.

### api/submit.js - the ownership rule

The client sends `playerId` as a **HINT ONLY**. The server queries which players the login
actually owns and decides from that list:

- 1 player: linked automatically, the hint is ignored entirely
- 2+ players: the hint is accepted ONLY if it appears in the login's own list, otherwise 400
- 0 players: stored null for the coach to link manually

This is what stops a parent attaching a profile to another family's child. Do not
"simplify" it by trusting the request body.

### Pages

- `index.html` - intro animation (escaped-JSON runtime). 385 lines.
- `handbook.html` - program manual plus player form. Home page for all roles. 497 lines.
- `login.html` - sign in plus forced password change. Plain HTML.
- `reports.html` - parent report list, grouped by player. Plain HTML.
- `coach.html` - coach portal, 844 lines, three tabs. Plain HTML.
- `crusaders-handbook-2026-27.pdf` - 4.41 MB, 8 pages, gated by middleware.
  Pages 4 and 7 were authored sideways on portrait canvases; `/Rotate 90` was applied to
  both so they display landscape. The print file at the coil-binder does NOT have this.

### coach.html tabs

- **Players** - roster paste (preview then commit), add single player, roster table with
  profile submitted / report count / parent count, submissions list with a per-row dropdown
  to link each submission to a player
- **Parent Logins** - create with player checkboxes, temp password shown ONCE, reset (warns
  when resetting self), assign players, delete (own row's delete hidden)
- **Reports** - multi-file picker with filename auto-match, sequential upload with per-file
  status, published table showing "N of M downloaded" plus which parents opened it, delete

**Filename matching uses WHOLE WORDS, not substrings.** With `indexOf`, a file named
`Jackson_Lightfoot.pdf` matches a player called `Jack Li` (jack inside jackson, li inside
lightfoot) and one child's report gets published to another family. Ties break toward the
longer name so `Samantha Ngo` beats `Sam Ng`. Do not "simplify" this.

---

## Conventions

- API responses are **camelCase**; DB columns are snake_case. Map explicitly.
- Neon returns bigint as **strings**. Always `Number()` ids and counts.
- Postgres booleans can arrive as `'f'` or null. Compare with `=== true`, never truthiness.
- Validate numeric ids with `Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER`.
  Without the upper bound, `Number("9".repeat(30))` is `1e30`, passes isInteger, and
  overflows bigint in Postgres. Values above MAX_SAFE_INTEGER also round silently and can
  resolve to the WRONG record.
- Never confirm existence: wrong password and unknown username return identical responses;
  another family's report id and a nonexistent one both 404; an unknown admin resource and
  a real one both 401 when unauthenticated.
- Escape everything interpolated into HTML with an `esc()` helper - Steve types the player
  names and report titles.
- Duplicate-name detection strips apostrophes BEFORE collapsing punctuation, so `O'Brien`
  and `OBrien` match. Replacing the apostrophe with a space produces `o brien` vs `obrien`
  and creates duplicate player records.

## Drill tag icons

The nine legend icons at the top of the drills page and the small icons in the tag chips
share the same SVG paths from `ICONS`. Three palettes exist:

- `CAT_SOLID` - saturated legend colours (`pass: #2D6CDF`)
- `CAT` - `[paleBackground, darkenedText, iconKey]` per category
- `TAG_COLORS` - maps each tag string to its `CAT` entry, extended with `CAT_SOLID` as a
  fourth element so chips can use the legend colour

Chips render the icon in **white on an 18px `t.solid` tile**. Originally they stroked the
icon in `t.fg` (the darkened text colour) at 13px with no tile, which read as grey specks.

## pdf-lib gotcha

`StandardFonts.Helvetica` uses WinAnsi (CP1252) and `drawText` **THROWS** on anything it
cannot encode. One emoji from a phone keyboard 500s the whole PDF. `api/pdf.js` has a
`winAnsiSafe()` sanitizer that strips unsupported code points. Accents, em dashes, smart
quotes and ellipses are all valid CP1252 and pass through untouched.
Page breaks must be checked **inside** the per-line loop or long answers run off the page.

## Database schema (Neon `neon-lime-ladder`)

    players        id, name, jersey, created_at
    logins         id, username UNIQUE, password_hash, must_change (default true),
                   token_version (default 1), is_coach (default false), created_at
    login_players  login_id, player_id  (composite PK, both ON DELETE CASCADE)
    reports        id, player_id, title, pdf BYTEA, published_at
    report_views   report_id, login_id, viewed_at  (composite PK, both FKs CASCADE -
                   verified working)
    submissions    id, created_at, full_name, jersey, data JSONB, player_id BIGINT NULL

Password hash format: `s1$` then base64url salt then `$` then base64url key.
scrypt, 112 chars total.

## Env vars (Vercel)

- `DATABASE_URL` - auto from Neon integration
- `SESSION_SECRET` - Production plus Preview. **Missing = total lockout** (middleware fails
  closed and login 500s).
- `COACH_PASSWORD` - DELETED. The comments in list.js and pdf.js mentioning it are historical.

## Seeding a coach login

No UI creates a coach - `is_coach` is hard-coded false in admin-logins.js. Generate a hash
locally, then INSERT by hand.

    $sec = Read-Host "password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    "password length: $($plain.Length)"
    $plain | node --input-type=module -e "const chunks=[]; for await (const c of process.stdin) chunks.push(c); const pw = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,''); const { pathToFileURL } = await import('node:url'); const m = await import(pathToFileURL(process.cwd() + '/lib/auth.js').href); console.log(await m.hashPassword(pw));"
    $plain = $null

Do NOT use `$env:VAR = $plain` - PowerShell DELETES an env var when assigned an empty
string, so a mistyped prompt yields `undefined` in the child process.

Then, with Read-only OFF in the Vercel Query editor:

    insert into logins (username, password_hash, must_change, token_version, is_coach)
    values ('steve', '<hash>', false, 1, true);

## Smoke test after deploy

    Add-Type -AssemblyName System.Net.Http
    $h = New-Object System.Net.Http.HttpClientHandler
    $h.AllowAutoRedirect = $false
    $c = New-Object System.Net.Http.HttpClient($h)
    foreach ($p in @('/', '/login.html', '/handbook.html', '/coach.html', '/package.json', '/crusaders-handbook-2026-27.pdf', '/api/me', '/api/admin?resource=players', '/api/admin?resource=nope')) {
      $r = $c.GetAsync("https://crusaders-2016.vercel.app$p").Result
      $loc = ""; if ($r.Headers.Location) { $loc = " -> " + $r.Headers.Location.ToString() }
      "{0,-34} {1}{2}" -f $p, [int]$r.StatusCode, $loc
      $r.Dispose()
    }
    $c.Dispose()

Expected: `/` and `/login.html` 200; `/handbook.html`, `/coach.html`, `/package.json` and
the PDF all 302 to /login.html; `/api/me` **401 not 302**; **both** admin resources 401.

## Row-count check

Read-only is fine, one statement:

    select 'players' as t, count(*) from players union all select 'logins', count(*) from logins union all select 'login_players', count(*) from login_players union all select 'reports', count(*) from reports union all select 'report_views', count(*) from report_views union all select 'submissions', count(*) from submissions;

---

## Verified working in production

Tested end to end across two sessions:
login, forced password change, handbook landing, adaptive nav button, sign out, gated PDF
download, roster paste import, parent login creation with a two-child family, temp password
one-time display, multi-file report upload with filename auto-match, parent report list
grouped by player, NEW badge clearing per login, coach-side "N of M downloaded" tracking,
player form auto-linking for one-child and two-child logins, the picker's 400 when no
choice is made, and draft isolation between accounts on one browser.

589 automated assertions across 14 test suites, zero failures.

**Database was cleared to a single `steve` coach login** and is ready for Steve's real
roster. All test players, logins, reports and submissions were deleted.

---

## Outstanding work

1. Steve imports his real roster via the Players tab.
2. RESOLVED. handbook.html has 46 em dashes and 5 en dashes, all correctly encoded UTF-8,
   and zero mojibake sequences. The original "52 mojibake em-dashes" report was almost
   certainly Get-Content misreading UTF-8 as ANSI, not a real corruption.
3. Consider adding `*.bak*` to `.gitignore` - backups are being committed, including a
   1.3 MB `handbook.html.bak5`.

## Known accepted limitations

- Downloaded is not the same as read. `report_views` records first download only.
- Mobile browsers keep session cookies alive in the background, so the 12h `exp` is the
  real bound, not browser close.
- `setPlayers()` in admin-logins.js is not transactional (neon http mode). Worst case is a
  login with zero players, visible in the UI and one click to fix.
- Roster import re-paste adds new names but does NOT update jersey numbers on existing
  rows. Use Edit for those.
- No self-service password reset. Steve resets from the portal.
- No failed-login throttling. Serverless has no shared memory; would need a DB column.
  Temp passwords are 32 to the 12th so brute force is impractical, but parent-chosen
  passwords after first change are only min-8 with no composition rules (NIST).
- Report upload ceiling is roughly 3 MB per PDF (Vercel's 4.5 MB body limit less base64
  inflation). Steve's ChatGPT-generated text PDFs run 50-300 KB.
- `api/pdf.js` leaves a double space where an emoji was stripped from a name.
- Signing out discards an unsubmitted form draft. Deliberate - see the localStorage note.
- The web PDF differs from the print file: pages 4 and 7 carry a rotation flag.
