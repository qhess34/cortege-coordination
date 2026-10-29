#!/bin/sh
# Démarre l'application sur une base de test vide, avec un administrateur et un organisateur connus.
set -e
cd "$(dirname "$0")/.."
export DATABASE_URL="${E2E_DATABASE_URL:-postgres://cortege:cortege@localhost:5432/cortege_e2e}"
export OVERPASS_URL=http://127.0.0.1:3999/api/interpreter
export PORT=3100 WEB_DIST=web/dist COOKIE_SECURE=false
# Chaque test se connecte : limites relevées pour la suite (les limites réelles sont testées côté serveur).
export LOGIN_RATE_LIMIT=1000 JOIN_RATE_LIMIT=1000
psql "$DATABASE_URL" -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
ADMIN_PASSWORD=admin-e2e-motdepasse npx tsx server/src/cli/create-admin.ts admin "Admin E2E" > /dev/null
npx tsx e2e/mock-overpass.ts &
exec npx tsx server/src/main.ts
