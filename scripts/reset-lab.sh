#!/usr/bin/env bash
# Reset the Bitvulnex lab to a clean state. Wipes the db volume.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down -v
docker compose up -d --build

echo
echo "Bitvulnex lab reset. http://localhost/ should respond shortly."
