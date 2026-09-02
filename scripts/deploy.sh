#!/usr/bin/env bash
# Run on the server after a git pull (also used by GitHub Actions over SSH).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/limiria/public_html/wango}"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

echo "==> Deploying in $APP_DIR (branch: $BRANCH)"

# Keep production secrets; never overwrite .env from git.
if [[ ! -f .env ]]; then
  echo "ERROR: .env missing in $APP_DIR — create it before deploying."
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing dependencies"
npm install --omit=dev

echo "==> Running migrations"
npm run db:migrate

echo "==> Restarting app"
if command -v pm2 >/dev/null 2>&1 && pm2 describe wwngo >/dev/null 2>&1; then
  pm2 restart wwngo --update-env
  pm2 save
elif command -v pm2 >/dev/null 2>&1; then
  pm2 start src/index.js --name wwngo --update-env
  pm2 save
elif [[ -f tmp/restart.txt ]]; then
  # Phusion Passenger
  mkdir -p tmp
  touch tmp/restart.txt
else
  # Fallback: kill previous node for this app, then start again
  pkill -f "$APP_DIR/src/index.js" 2>/dev/null || true
  nohup npm start >>"$APP_DIR/app.log" 2>&1 &
  echo "Started with nohup (logs: $APP_DIR/app.log)"
fi

echo "==> Deploy complete"
curl -fsS "https://wango.toolkitpro.cloud/health" || true
echo
