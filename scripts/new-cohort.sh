#!/usr/bin/env bash
# Phase 11 slice 4 — create a new CTF cohort via the admin API and
# print its flag table.
#
# Usage:  scripts/new-cohort.sh <cohort-name> [--hints=on|off]
#
# Prerequisites:
#   - docker compose up -d (web container running)
#   - CTF_MODE=true in .env (otherwise the admin endpoints 404)
#   - an admin account; default uses admin@bvbe.local /
#     change-me-after-first-login. Override with BVBE_ADMIN_EMAIL +
#     BVBE_ADMIN_PASSWORD.
#
# What it does:
#   1. Logs in as admin against the running stack.
#   2. POSTs /api/v2/admin/ctf/cohorts with the chosen name and hint
#      default. Cohort gets a unique salt fingerprint derived from
#      the deployment's CTF_SALT.
#   3. Prints the canonical 44-flag table for this cohort by calling
#      `pnpm exec tsx scripts/derive-flags.ts`. Save the output to a
#      cohort-private file outside the repo if you want to hand it
#      to instructors.

set -euo pipefail

NAME="${1:-}"
HINTS="off"
for arg in "$@"; do
  case "$arg" in
    --hints=on) HINTS="on" ;;
    --hints=off) HINTS="off" ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "Usage: scripts/new-cohort.sh <cohort-name> [--hints=on|off]" >&2
  exit 2
fi

BASE_URL="${BVBE_BASE_URL:-http://localhost}"
ADMIN_EMAIL="${BVBE_ADMIN_EMAIL:-admin@bvbe.local}"
ADMIN_PASSWORD="${BVBE_ADMIN_PASSWORD:-change-me-after-first-login}"

echo "==> Logging in as $ADMIN_EMAIL"
LOGIN=$(curl -fsS -X POST "$BASE_URL/api/v2/auth/login" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | grep -oE '"access":"[^"]*"' | sed 's/"access":"//;s/"$//')
if [ -z "$TOKEN" ]; then
  echo "Login failed:" >&2
  echo "$LOGIN" >&2
  exit 1
fi

HINTS_DEFAULT=$([ "$HINTS" = "on" ] && echo "true" || echo "false")
echo "==> Creating cohort name=$NAME hintsDefault=$HINTS_DEFAULT"
CREATE=$(curl -fsS -X POST "$BASE_URL/api/v2/admin/ctf/cohorts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"name\":\"$NAME\",\"hintsDefault\":$HINTS_DEFAULT}")
echo "$CREATE"
echo

COHORT_ID=$(echo "$CREATE" | grep -oE '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"$//')
SALT_FP=$(echo "$CREATE" | grep -oE '"saltFingerprint":"[^"]*"' | sed 's/"saltFingerprint":"//;s/"$//')
echo "==> Cohort id=$COHORT_ID salt-fp=$SALT_FP"
echo

echo "==> Canonical 44-flag table"
echo "    (give this file to the instructor; do NOT share with trainees)"
echo
if [ -n "${CTF_SALT:-}" ]; then
  pnpm exec tsx scripts/derive-flags.ts
else
  echo "    (set CTF_SALT in your shell to print the table)"
fi
