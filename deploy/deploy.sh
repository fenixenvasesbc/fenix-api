#!/bin/sh
set -eu

cd "$(dirname "$0")"

COMPOSE="docker compose --env-file .env --env-file .env.image"

echo "== Pulling image =="
$COMPOSE pull api worker

echo "== Running pending Prisma migrations =="
$COMPOSE run --rm api pnpm prisma migrate deploy

echo "== Starting api + worker =="
$COMPOSE up -d api worker

echo "== Cleaning up dangling images =="
docker image prune -f

echo "== Done =="
