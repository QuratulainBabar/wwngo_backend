#!/usr/bin/env bash
# Run on the server after a git pull (also used by GitHub Actions over SSH).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/limiria/public_html/wango}"
BRANCH="${DEPLOY_BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/QuratulainBabar/wwngo_backend.git}"

cd "$APP_DIR"

echo "==> Deploying in $APP_DIR (branch: $BRANCH)"

# Keep production secrets; never overwrite .env from git.
if [[ ! -f .env ]]; then
  echo "ERROR: .env missing in $APP_DIR — create it before deploying."
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "==> Initializing git repo"
  git init
  git remote add origin "$REPO_URL"
fi

git remote set-url origin "$REPO_URL"
git fetch origin "$BRANCH"
git checkout -f -B "$BRANCH" "origin/$BRANCH"

echo "==> Installing dependencies"
npm install --omit=dev

echo "==> Running migrations"
npm run db:migrate

echo "==> Restarting app"
mkdir -p tmp
touch tmp/restart.txt || true

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe wwngo >/dev/null 2>&1; then
    pm2 restart wwngo --update-env
  else
    pkill -f "$APP_DIR/src/index.js" 2>/dev/null || true
    sleep 1
    pm2 start "$APP_DIR/src/index.js" --name wwngo --cwd "$APP_DIR"
  fi
  pm2 save || true
else
  pkill -f "$APP_DIR/src/index.js" 2>/dev/null || true
  sleep 1
  nohup npm start >>"$APP_DIR/app.log" 2>&1 &
  echo "Started with nohup (logs: $APP_DIR/app.log)"
fi

echo "==> Health check"
ok=0
for i in 1 2 3 4 5 6; do
  sleep 2
  if curl -fsS "https://wango.toolkitpro.cloud/health"; then
    echo
    ok=1
    break
  fi
  echo "Attempt $i failed, retrying..."
done
if [[ "$ok" -ne 1 ]]; then
  echo "Health check failed"
  pm2 status || true
  tail -n 50 "$APP_DIR/app.log" 2>/dev/null || true
  exit 1
fi

echo "==> Deploy complete"