# CLAUDE.md - 2016 Crusaders site

Youth hockey program site for client Steve, built by Bear Valley Solutions (Joe).

- Local: `C:\Users\glara\OneDrive\Desktop\Crusaders_Plan\Hockey Season Handbook Updates\deploy`
- Live: https://crusaders-2016.vercel.app/
- Vercel project `crusaders-2016`, team Bear Valley Solutions (Hobby), user `joe-6694`
- Repo: `JoeLaratta/Crusaders_2016`, branch `main`, NOT connected to Vercel - deploys are manual
- Deploy order: `npx vercel --prod` FIRST, then `git add . / commit / push`

## How Joe wants to work

- One command at a time. Wait for the result before sending the next.
- If output needs pasting back, say so immediately after that command, not at the bottom.
- Concise, copy-paste ready, senior-dev tone. Flag risks and edge cases.
- Stack: JavaScript, JSON, SQL, APIs, serverless. Windows PowerShell 5.
- **When writing a PowerShell block to chat, never include triple-backtick fences inside
  the here-string content.** They terminate the outer markdown fence and shatter one
  copy box into eight. For files containing fenced markdown, build the file and deliver
  it as a download instead of a paste.

---

## CRITICAL: handbook.html and index.html are NOT plain HTML

Both files contain the real document as an **escaped JSON string** inside a `<script>`
block, rendered by a small custom runtime.

- quotes are `\"`, `</div>` is written `<\u002Fdiv>`, `</script>` is `<\u002Fscript>`
- newlines are the two characters `\n` - NEVER a real line break
- A literal newline breaks the JSON parse and kills the whole page with
  "Error unpacking: Bad control character in string literal." This has happened twice.

**Edit procedure, every time:**

1. `Copy-Item handbook.html handbook.html.bak`
2. Build exact `$old`/`$new` strings, confirm match count is exactly 1 BEFORE writing
3. Keep all replacement JS on ONE line - no newlines
4. Verify line count is unchanged (386) against the .bak
5. Only then deploy

**Template syntax:** `{{ f.field }}` bindings, `sc-camel-on-change="{{ set.field }}"`,
`sc-camel-on-click="{{ handler }}"`, `style-hover="..."`, `class="noprint"`.
Interpolation works inside `style` attributes. `this.setState({...})` MERGES.
Handlers live in the object returned at the very end of the file.

`login.html`, `reports.html` and `coach.html` are ordinary HTML - none of this applies to them.

---

## Environment gotchas

- **OneDrive**: folder is synced. Pause syncing before repeated writes to the 1.3 MB
  files or you get "Access is denied" / phantom "does not exist".
- **PS5 here-strings** (`@'...'@`): the `'@` terminator must start its own line.
  If the prompt stays at `>>` the paste was mangled - Ctrl+C and use another method.
  Never put a write command and a read command on the same pasted line; they merge
  and PowerShell throws "Unexpected token". This silently skipped a file write once.
- **PS5 encoding**: `Set-Content -Encoding utf8` writes a BOM and reads as ANSI.

  Correct write pattern:

      [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))

  Correct read pattern:

      [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)

  Plain `Get-Content` misreads em dashes as mojibake - the FILE is usually fine, the
  reader is wrong. Always verify with ReadAllText before believing a mojibake report.
- **Verification greps**: strip comment lines first or your own comment text will
  trip the check. This wasted three round trips:

      ($t -split "`n" | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"

- **Vercel Query editor**: ONE statement per Run, Read-only toggle defaults ON.
  Don't paste the sql fence tag - it throws `syntax error at or near "sql"`.
- **PS5 `Invoke-WebRequest -MaximumRedirection 0`** throws on 3xx and corrupts the
  exception object. Use `System.Net.Http.HttpClient` with `AllowAutoRedirect = $false`.

---

## Auth architecture (built Aug 2026)

The whole site sits behind a login. One login per parent, many-to-many with players.

### The Edge/Node split - do not collapse these two files

`middleware.js` runs on the Vercel **Edge runtime**, which has no `node:crypto` and
no `Buffer`. Therefore:

- **`lib/token.js`** - ISOMORPHIC. Web Crypto (`crypto.subtle`) + `atob`/`btoa` only.
  Imported by middleware AND by lib/auth.js. Adding `Buffer` here breaks the whole site.
- **`lib/auth.js`** - NODE ONLY. scrypt hashing, temp passwords, the `requireSession`
  guard. Re-exports everything from token.js so API routes only import this one file.
  NEVER import this from middleware.js.

`createToken` / `readToken` are **async** (Web Crypto is promise-based). Forgetting
`await` yields a truthy Promise that passes an `if` check - i.e. it fails open.

### Session model

- Signed HMAC-SHA256 token: `base64url(payload).signature`
- Payload: `{ lid, ver, mc, coach, exp }` - login id, token_version, must_change, is_coach
- Cookie `cru_session`: HttpOnly, Secure, SameSite=Strict, **no Max-Age** (dies on
  browser close). 12-hour hard cap lives in `exp`.
- SameSite=Strict means the cookie is NOT sent when arriving from an external link
  (email, SMS). First click looks logged out. Accepted trade-off.

### Revocation

`token_version` is checked **against the database** by every route that returns data.
Middleware CANNOT check it (no DB on Edge), so a revoked session can still fetch
static HTML for up to 12h but gets nothing from any API. Bumping `token_version`
signs that login out everywhere.

### The requireSession convention

Every protected route starts with:

    const session = await requireSession(req, res, { requireCoach: true });
    if (!session) return;

It writes the 401/403 itself and returns null. Options:

- `allowMustChange: true` - ONLY for change-password and logout
- `requireCoach: true` - coach-only endpoints

Then re-check `token_version` against the DB:

    const rows = await sql`select id, token_version from logins where id = ${session.lid} limit 1`;
    if (!checkVersion(session, rows[0])) return res.status(401).json({ error: '...' });

### must_change flow

New logins get a temp password and `must_change = true`. The token carries `mc: true`
and is rejected by every route except change-password and logout. Middleware sends
those users to /login.html, which detects the 403 from /api/me and shows the
change-password panel.

---

## Files

### lib/

- `token.js` - isomorphic sign/verify/cookie helpers (Edge-safe)
- `auth.js` - Node-only hashing + requireSession/checkVersion

### middleware.js

Gates all static routes. Public: `/`, `/index.html`, `/login.html`, `/favicon.ico`,
`/robots.txt`, and an explicit extension allowlist (css/js/png/woff/etc).
The allowlist is deliberately NOT a wildcard - that keeps `/package.json`,
`/CLAUDE.md` and stray `.pdf` files gated.
`/api/*` is EXCLUDED from the matcher: routes self-guard, and intercepting them
would return HTML redirects to fetch() callers.
**Fails closed** - any thrown error redirects to login rather than serving the file.

Requires `@vercel/functions` for `next()`. Non-Next projects cannot use
`NextResponse.next()`, and a bare `return undefined` is not the current contract.

### api/

| Route | Method | Auth | Notes |
|---|---|---|---|
| `login.js` | POST | public | Timing-safe: dummy hash on unknown user, ~0.4ms delta |
| `logout.js` | POST | none | Works with broken/absent token, touches no DB |
| `change-password.js` | POST | mc allowed | Requires current pw, bumps token_version, issues fresh cookie |
| `me.js` | GET | session | Identity + linked players |
| `reports.js` | GET | session | List; does NOT select r.pdf (blobs) |
| `report-pdf.js` | GET ?id= | session | Ownership proven in the same query as the bytes |
| `submit.js` | POST | public | Profile form (TODO: move behind login) |
| `list.js` | GET | coach | Submissions list (converted from COACH_PASSWORD) |
| `pdf.js` | GET ?id= | coach | Profile PDF via pdf-lib |
| `admin-players.js` | GET/POST/PATCH | coach | Roster + counts. No DELETE by design |
| `admin-logins.js` | GET/POST/PATCH/DELETE | coach | Create/reset/assign. Cannot delete self |
| `admin-reports.js` | - | coach | NOT BUILT YET |

### Pages

- `index.html` - intro animation (escaped-JSON runtime). TODO: button -> /login.html
- `handbook.html` - program manual (escaped-JSON runtime)
- `login.html` - sign in + forced password change. Plain HTML.
- `reports.html` - parent report list, grouped by player. Plain HTML.
- `coach.html` - OLD COACH_PASSWORD version. Needs rebuild (Players/Logins/Reports tabs).

---

## Conventions

- API responses are **camelCase**; DB columns are snake_case. Map explicitly.
- Neon returns bigint as **strings**. Always `Number()` ids and counts.
- Postgres booleans can arrive as `'f'` or null. Compare with `=== true`, never truthiness.
- Validate numeric ids with `Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER`.
  Without the upper bound, `Number("9".repeat(30))` is `1e30`, passes isInteger, and
  overflows bigint in Postgres. Values above MAX_SAFE_INTEGER also round silently
  and can resolve to the WRONG record.
- Never confirm existence: wrong password and unknown username return identical
  responses; another family's report id and a nonexistent one both 404.
- Escape everything interpolated into HTML with an `esc()` helper - Steve types the
  player names and report titles.

## pdf-lib gotcha

`StandardFonts.Helvetica` uses WinAnsi (CP1252) and `drawText` **THROWS** on anything
it can't encode. One emoji from a phone keyboard 500s the whole PDF. `api/pdf.js` has
a `winAnsiSafe()` sanitizer that strips unsupported code points. Accents, em dashes,
smart quotes and ellipses are all valid CP1252 and pass through untouched.
Page breaks must be checked **inside** the per-line loop or long answers run off the
bottom of the page.

## Database schema (Neon `neon-lime-ladder`)

    players        id, name, jersey, created_at
    logins         id, username UNIQUE, password_hash, must_change (default true),
                   token_version (default 1), is_coach (default false), created_at
    login_players  login_id, player_id  (composite PK, both ON DELETE CASCADE)
    reports        id, player_id, title, pdf BYTEA, published_at
    report_views   report_id, login_id, viewed_at  (composite PK - required by the
                   ON CONFLICT clause in report-pdf.js)
    submissions    id, created_at, full_name, jersey, data JSONB, player_id BIGINT NULL

Password hash format: `s1$<base64url salt>$<base64url key>`, scrypt, 112 chars.

## Env vars (Vercel)

- `DATABASE_URL` - auto from Neon integration
- `SESSION_SECRET` - Production + Preview. **Missing = total lockout** (middleware
  fails closed and login 500s).
- `COACH_PASSWORD` - LEGACY. Delete once coach.html is rebuilt and deployed.

## Seeding the first coach login

No UI creates a coach. Generate a hash locally, then INSERT the row by hand.

    $sec = Read-Host "password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    "password length: $($plain.Length)"
    $plain | node --input-type=module -e "const chunks=[]; for await (const c of process.stdin) chunks.push(c); const pw = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,''); const { pathToFileURL } = await import('node:url'); const m = await import(pathToFileURL(process.cwd() + '/lib/auth.js').href); console.log(await m.hashPassword(pw));"
    $plain = $null

Do NOT use `$env:VAR = $plain` - PowerShell DELETES an env var when assigned an
empty string, so a mistyped prompt yields `undefined` in the child process.

Then, with Read-only OFF in the Vercel Query editor:

    insert into logins (username, password_hash, must_change, token_version, is_coach)
    values ('steve', '<hash>', false, 1, true);

## Smoke test after deploy

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    foreach ($p in @('/', '/login.html', '/handbook.html', '/package.json', '/api/me')) {
      $r = $client.GetAsync("https://crusaders-2016.vercel.app$p").Result
      $loc = ""; if ($r.Headers.Location) { $loc = " -> " + $r.Headers.Location.ToString() }
      "{0,-18} {1}{2}" -f $p, [int]$r.StatusCode, $loc
      $r.Dispose()
    }
    $client.Dispose()

Expected: `/` and `/login.html` 200; `/handbook.html` and `/package.json` 302 to
/login.html; `/api/me` **401 not 302** (proves the matcher excludes /api).

---

## Outstanding work

1. `api/admin-reports.js` - upload PDF (base64 -> BYTEA), list download status.
   Vercel body limit is 4.5 MB, so ~3.3 MB PDF ceiling after base64 inflation.
   Steve's reports come from ChatGPT as text PDFs (50-300 KB), so this is fine.
2. Rebuild `coach.html` with Players / Logins / Reports tabs. **Until this is done,
   do NOT deploy** - list.js and pdf.js have already been converted to session auth
   and camelCase, which breaks the current coach.html.
3. Rewire index.html "Welcome Crusader" button -> `/login.html`.
4. Move the profile form behind login; auto-link `submissions.player_id`.
   Two-player family needs a picker.
5. Delete the `COACH_PASSWORD` env var.
6. Verify the 52 mojibake em-dashes in handbook.html were actually fixed.
7. Confirm the new index.html animation is live.

## Known accepted limitations

- Downloaded != read. `report_views` records first download only.
- Mobile browsers keep session cookies alive in the background, so the 12h `exp`
  is the real bound, not browser close.
- `setPlayers()` in admin-logins.js is not transactional (neon http mode). Worst
  case is a login with zero players, visible in the UI and one click to fix.
- No self-service password reset. Steve resets from the portal.
- No failed-login throttling. Serverless has no shared memory; would need a DB column.
  Temp passwords are 32^12 so brute force is impractical, but parent-chosen
  passwords after first change are only min-8 with no composition rules (NIST).
- `api/pdf.js` leaves a double space where an emoji was stripped from a name
  (`Ben (emoji) Smith` -> `Ben  Smith`). Cosmetic only.
