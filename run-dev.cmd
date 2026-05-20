@echo off
cd /d "%~dp0"
node node_modules\vite\bin\vite.js --port 5500 --strictPort --open /login.html
