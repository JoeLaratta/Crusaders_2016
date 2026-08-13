@echo off
cd /d "%~dp0"
call npx vercel --prod
git add .
git commit -m "Update handbook"
git push
pause