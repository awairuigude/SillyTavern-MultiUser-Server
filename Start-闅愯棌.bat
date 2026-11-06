if "%1"=="hide" goto CmdBegin
powershell -Command "Start-Process '%~0' -ArgumentList 'hide' -WindowStyle Hidden"
exit
:CmdBegin
echo off
pushd %~dp0
set NODE_ENV=production
call npm install --no-save --no-audit --no-fund --loglevel=error --no-progress --omit=dev
node server.js %*
pause
popd
