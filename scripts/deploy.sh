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

echo "==> Seeding admin user"
npm run db:seed

echo "==> Restarting app with npx pm2"
PM2_BIN="$APP_DIR/node_modules/.bin/pm2"
if [[ ! -x "$PM2_BIN" ]]; then
  echo "ERROR: pm2 binary missing at $PM2_BIN"
  exit 1
fi

# Stop previous PM2 process if present.
"$PM2_BIN" stop wwngo >/dev/null 2>&1 || true
"$PM2_BIN" delete wwngo >/dev/null 2>&1 || true

# Stop leftover bare `node src/index.js` only (avoid pkill-by-path self-kill).
for pid in $(pgrep -f '^node .*(/wango/)?src/index\.js' || true); do
  kill "$pid" 2>/dev/null || true
done
sleep 1

"$PM2_BIN" start "$APP_DIR/src/index.js" --name wwngo --cwd "$APP_DIR"
"$PM2_BIN" save || true
"$PM2_BIN" status || true

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
  "$PM2_BIN" status || true
  "$PM2_BIN" logs wwngo --lines 50 --nostream || true
  exit 1
fi

echo "==> Deploy complete"