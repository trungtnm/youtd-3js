#!/usr/bin/env bash
# Deploys the committed HEAD to the VPS: copies the source (git archive), builds the image
# there, backs up the live database and restarts the service. Uncommitted changes are
# refused, so what runs is always a commit.
# Usage: npm run deploy:vps   (YOUTD_HOST=ctb-1, YOUTD_HOME=/home/trungtran/projects/youtd)
# Rollback: ssh in, cd $YOUTD_HOME/releases/<old sha> && YOUTD_TAG=<old sha> docker compose up -d
set -euo pipefail

HOST=${YOUTD_HOST:-ctb-1}
HOME_DIR=${YOUTD_HOME:-/home/trungtran/projects/youtd}
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
# Everything under $home belongs to its owner; the container runs as the owner of data/.
owner=$(stat -c %u:%g "$home")
chown -R "$owner" "$home/releases/$sha"
export YOUTD_HOME=$home YOUTD_UID=$(stat -c %u "$home/data") YOUTD_GID=$(stat -c %g "$home/data") YOUTD_TAG=$sha
# Compose reads .env beside compose.yaml, so a plain `docker compose up -d` in this release
# (after editing $home/.env) keeps the same image, user and paths. No secrets here.
printf 'YOUTD_HOME=%s\nYOUTD_TAG=%s\nYOUTD_UID=%s\nYOUTD_GID=%s\n' "$home" "$sha" "$YOUTD_UID" "$YOUTD_GID" > .env
chown "$owner" .env
docker compose build
if [ -n "$(docker compose ps -q --status running youtd)" ]; then
  echo "Backing up the live database"
  # </dev/null: this script arrives on stdin, and exec would swallow the rest of it.
  docker compose exec -T youtd node --disable-warning=ExperimentalWarning server/backup.js </dev/null
fi
docker compose up -d --wait --wait-timeout 90
docker tag "youtd-reforged:$sha" youtd-reforged:latest
ln -sfn "$home/releases/$sha" "$home/current"
chown -h "$owner" "$home/current"
curl -fsS http://127.0.0.1:3200/api/me >/dev/null && echo "Healthy: $sha is live"
REMOTE
