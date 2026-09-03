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

echo "==> Restarting app with npx pm2"
# Stop old nohup/manual node process so the port is free for PM2.
pkill -f "$APP_DIR/src/index.js" 2>/dev/null || true
sleep 1

if npx --yes pm2 describe wwngo >/dev/null 2>&1; then
  npx --yes pm2 restart wwngo --update-env
else
  npx --yes pm2 delete wwngo >/dev/null 2>&1 || true
  npx --yes pm2 start "$APP_DIR/src/index.js" --name wwngo --cwd "$APP_DIR"
fi
npx --yes pm2 save || true
npx --yes pm2 status || true

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
  npx --yes pm2 status || true
  npx --yes pm2 logs wwngo --lines 50 --nostream || true
  tail -n 50 "$APP_DIR/app.log" 2>/dev/null || true
  exit 1
fi

echo "==> Deploy complete"