# Crusaders Handbook Site

Static site. No build step, no dependencies, no npm packages.

## Files
- `index.html` — intro animation, front door at `/`
- `handbook.html` — program manual, 8 sections, one long scroll
- `favicon.png` — tab icon

Both HTML files are fully self-contained: fonts, logo, CSS, and JS are
inlined. Do not add external asset references.

## Deploy
Live at https://crusaders-2016.vercel.app/
Vercel project `crusaders-2016` under team Bear Valley Solutions.
No Git connection — deploys are manual.

```powershell
npx vercel --prod
git add . ; git commit -m "message" ; git push
```

Deploy first, then push, so the live site is never behind GitHub.