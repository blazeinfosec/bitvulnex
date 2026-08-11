#!/usr/bin/env bash
# Find and heal individual poisoned web replicas.
#
# WHY THIS EXISTS
# ---------------
# V-34 (prototype pollution) sets `Object.prototype.adminPanel = true`
# for the lifetime of the Node process it lands on. Under `next dev`
# that inherited key poisons webpack's module-export helper, which does
# a `for...in` over its definition object and then hands the value to
# `Object.defineProperty` as a getter:
#
#   TypeError: Getter must be a function: true
#       at defineProperty (<anonymous>)
#       at eval (webpack-internal:///(rsc)/../../packages/db/src/index.ts)
#
# From then on that replica returns HTTP 500 on any route importing
# @bvbe/db. It never recovers. Because nginx round-robins /api/ across
# the `web-api` replicas, the symptom is ~1/N of requests failing on
# unrelated endpoints — easy to misread as a flaky app or as a finding.
#
# V-34 is a planted vulnerability and is NOT to be fixed. This script is
# an operational tool for benchmark runs: it identifies exactly which
# replica is poisoned so you can recycle that one instead of recycling
# the whole pool (which would throw away every warm replica's compile
# cache and stall the run).
#
# Two verified gotchas drove this script's shape:
#   1. Healing is `docker restart` ONLY because .next is a tmpfs mount
#      (docker-compose.yml `tmpfs:` on the web service). tmpfs is wiped
#      on container stop, so restart rebuilds a clean .next in ~5-6s.
#      If .next were a persisted/anonymous volume instead, restart is
#      UNRELIABLE (the poison may already be flushed to the on-disk
#      webpack cache and survive, failing with `TS5023: Unknown compiler
#      option 'adminPanel'`); the heal detects that case and escalates
#      to `docker rm -f -v` + recreate.
#   2. A poisoned replica may HANG rather than 500 (pollution also
#      breaks Prisma internals; an observed login took 300 seconds), so
#      every probe needs a deadline or the doctor hangs with it.
#
# HOW IT DETECTS
# --------------
# Probes each replica *directly* on its own 127.0.0.1:3000, bypassing
# nginx, so the check is per-process rather than round-robined. The
# probe is an unauthenticated POST /api/v2/auth/login with a
# non-existent email: it imports @bvbe/db (so it trips the poisoning)
# and returns 401 on a healthy replica, 500 on a poisoned one. It reads
# nothing and writes nothing, and it never traverses nginx, so it does
# not appear in the edge access log or perturb an agent's view.
#
# USAGE
#   scripts/web-pool-doctor.sh              # report only
#   scripts/web-pool-doctor.sh --heal       # restart poisoned replicas
#   scripts/web-pool-doctor.sh --heal --warm  # ...and pre-compile them
#   scripts/web-pool-doctor.sh --watch 60   # re-check every 60s
#
# Exit codes: 0 = all healthy, 1 = poisoned found (report mode),
#             2 = a replica is unreachable. Safe to poll from a harness.
set -uo pipefail

HEAL=0
WARM=0
WATCH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --heal)  HEAL=1; shift ;;
    --warm)  WARM=1; shift ;;
    --watch) WATCH="${2:?--watch needs an interval in seconds}"; shift 2 ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

# Routes worth pre-compiling on a freshly recycled replica. Kept short
# on purpose — these are the hot paths an agent fleet hits first; the
# rest compile on demand.
WARM_ROUTES=(
  /api/health
  /api/v2/me
  /api/v2/me/flags
  /api/v2/me/orders
  /api/v2/me/deposits
  /api/v2/me/withdrawals
  /api/v2/public/markets
)

# Probe one container's own port 3000. Echoes an HTTP status, "HANG"
# when the request exceeds the deadline, or "DEAD" when exec itself
# fails.
#
# The timeout is load-bearing, not defensive boilerplate. A polluted
# prototype also breaks Prisma's internals:
#
#   prisma:error n.getField(...)?.markAsError is not a function
#
# and a DB-touching route can then either 500 *or* wedge — an observed
# `POST /api/v2/auth/login 200 in 300728ms`. Without a deadline the
# probe inherits that 5-minute hang and the replica gets misreported as
# unreachable rather than poisoned. A hang is a poisoning signal, so it
# is treated as heal-eligible exactly like a 500.
PROBE_TIMEOUT_S=8

probe() {
  local c="$1" out
  out="$(timeout $((PROBE_TIMEOUT_S + 4)) docker exec "$c" node -e "
    fetch('http://127.0.0.1:3000/api/v2/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pool-doctor@example.test', password: 'x' }),
      signal: AbortSignal.timeout(${PROBE_TIMEOUT_S}000),
    }).then(r => console.log(r.status)).catch(e => console.log(
      e.name === 'TimeoutError' || e.name === 'AbortError' ? 'HANG' : 'ERR'
    ));
  " 2>/dev/null)"
  # A `timeout`-killed exec produces no stdout; treat that as a hang too.
  case "$out" in
    ""|*"signal"*) echo HANG ;;
    *) echo "$out" ;;
  esac
}

warm() {
  local c="$1" r
  for r in "${WARM_ROUTES[@]}"; do
    timeout 30 docker exec "$c" node -e "
      fetch('http://127.0.0.1:3000$r', { signal: AbortSignal.timeout(25000) })
        .catch(() => {});
    " >/dev/null 2>&1
  done
}

# Only the `web-api-N` replica pool. The pinned `web` (pages/_next/HMR)
# is deliberately excluded — V-34 lands on /api/ (the pool), never on
# `web`, and bouncing it would drop HMR/dev state — matching the strict
# service=web-api scope the watchdog sidecar uses. The regex anchors on
# `-api-` so a stray `-web-1`, `db-1`, or `redis-1` can never be selected.
replicas() {
  docker compose ps --format '{{.Name}}' 2>/dev/null \
    | grep -E '(^|-)web-api-[0-9]+$' | sort
}

run_once() {
  local poisoned=() c s rc=0

  # 401 is the only healthy answer. 500 and HANG are both prototype-
  # pollution signatures (throw vs wedge, depending on which internal
  # the polluted key breaks first) and both recycle. DEAD/unexpected
  # also recycle — a replica nginx is still round-robining into must
  # either serve or be replaced.
  for c in $(replicas); do
    s="$(probe "$c")"
    case "$s" in
      401)  printf '  %-26s healthy    (401)\n' "$c" ;;
      500)  printf '  %-26s POISONED   (500)\n' "$c"; poisoned+=("$c") ;;
      HANG) printf '  %-26s POISONED   (hung >%ss)\n' "$c" "$PROBE_TIMEOUT_S"; poisoned+=("$c") ;;
      *)    printf '  %-26s UNHEALTHY  (%s)\n' "$c" "$s"; poisoned+=("$c") ;;
    esac
  done

  if [[ ${#poisoned[@]} -eq 0 ]]; then
    echo "  -> pool clean"
    return 0
  fi

  # Reachable only with poisoned replicas (the -eq 0 case returned above).
  if [[ $HEAL -eq 1 ]]; then
    # `docker restart` heals because .next is a tmpfs mount (see the
    # `tmpfs:` block on the web service in docker-compose.yml): tmpfs
    # is wiped whenever the container stops, so the restarted process
    # always rebuilds a clean .next and the V-34 poison is gone.
    # Restart keeps the container name/ordinal stable and recovers in
    # ~5-6s, vs ~15s+ for a cold rm+recreate.
    #
    # If .next is NOT tmpfs (someone reverted the compose change),
    # restart is UNRELIABLE — the poison may already be flushed to a
    # persisted .next and survive. This heal verifies each restarted
    # replica actually answers 401 and escalates to rm+recreate for
    # any that don't, so it is correct either way.
    echo "  -> restarting ${#poisoned[@]} replica(s): ${poisoned[*]}"
    docker restart "${poisoned[@]}" >/dev/null 2>&1

    local stubborn=() c ok
    for c in "${poisoned[@]}"; do
      ok=0
      for _ in $(seq 1 20); do
        [[ "$(probe "$c")" == "401" ]] && { ok=1; break; }
        sleep 1
      done
      [[ $ok -eq 1 ]] || stubborn+=("$c")
    done

    if [[ ${#stubborn[@]} -gt 0 ]]; then
      # Restart didn't clear these (non-tmpfs .next). Nuke the volume.
      echo "     restart insufficient for ${stubborn[*]} — recreating with rm -v"
      docker rm -f -v "${stubborn[@]}" >/dev/null 2>&1
      docker compose up -d >/dev/null 2>&1
      local waited=0 bad=1
      while [[ $waited -lt 180 ]]; do
        bad=0
        for c in $(replicas); do
          [[ "$(probe "$c")" == "401" ]] || bad=$((bad + 1))
        done
        [[ $bad -eq 0 ]] && break
        sleep 5; waited=$((waited + 5))
      done
      [[ $bad -eq 0 ]] || { echo "     still $bad bad — check logs"; rc=2; }
    fi

    if [[ $rc -eq 0 ]]; then
      echo "     pool clean again ($(replicas | wc -l) replicas)"
      if [[ $WARM -eq 1 ]]; then
        for c in $(replicas); do warm "$c"; done
        echo "     pre-compiled"
      fi
    fi
  else
    echo "  -> ${#poisoned[@]} bad. Re-run with --heal to restart just: ${poisoned[*]}"
    rc=1
  fi

  return $rc
}

if [[ "$WATCH" != "0" ]]; then
  echo "watching web pool every ${WATCH}s (ctrl-c to stop)"
  while true; do
    echo "[$(date +%H:%M:%S)] web pool:"
    run_once || true
    sleep "$WATCH"
  done
else
  echo "web pool:"
  run_once
fi
