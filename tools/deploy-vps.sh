#!/usr/bin/env bash
# Deploys the committed HEAD to the VPS: copies the source (git archive), builds the image
# there, backs up the live database and restarts the service. Uncommitted changes are
# refused, so what runs is always a commit.
# Usage: npm run deploy:vps   (YOUTD_HOST=ctb-1, YOUTD_HOME=/opt/youtd)
# Rollback: ssh in, cd $YOUTD_HOME/releases/<old sha> && YOUTD_TAG=<old sha> docker compose up -d
set -euo pipefail

HOST=${YOUTD_HOST:-ctb-1}
HOME_DIR=${YOUTD_HOME:-/opt/youtd}
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes; commit them first (the deploy ships HEAD)." >&2
  exit 1
fi
SHA=$(git rev-parse --short=12 HEAD)
echo "Deploying $SHA ($(git log -1 --format=%s)) to $HOST:$HOME_DIR"

git archive --format=tar HEAD | ssh "$HOST" "mkdir -p '$HOME_DIR/releases/$SHA' && tar -x -C '$HOME_DIR/releases/$SHA'"

ssh "$HOST" bash -s -- "$HOME_DIR" "$SHA" <<'REMOTE'
set -euo pipefail
home=$1; sha=$2
cd "$home/releases/$sha"
[ -f "$home/.env" ] || { echo "$home/.env is missing" >&2; exit 1; }
export YOUTD_HOME=$home
YOUTD_TAG=$sha docker compose build
if [ -n "$(docker compose ps -q --status running youtd)" ]; then
  echo "Backing up the live database"
  docker compose exec -T youtd node --disable-warning=ExperimentalWarning server/backup.js
fi
YOUTD_TAG=$sha docker compose up -d --wait --wait-timeout 90
docker tag "youtd-reforged:$sha" youtd-reforged:latest
ln -sfn "$home/releases/$sha" "$home/current"
curl -fsS http://127.0.0.1:3200/api/me >/dev/null && echo "Healthy: $sha is live"
REMOTE
