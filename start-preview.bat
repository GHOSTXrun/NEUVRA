@echo off
cd /d "%~dp0"
echo Open http://localhost:8080/
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 -m http.server 8080 --directory site
) else (
  python -m http.server 8080 --directory site
)
pause
