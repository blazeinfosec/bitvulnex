#!/usr/bin/env bash
# Reset the BVBE lab to a clean state. Wipes the db volume.
set -euo pipefail

docker compose down -v
docker compose up -d

echo
echo "BVBE lab reset. http://exchange.local/ should respond shortly."
