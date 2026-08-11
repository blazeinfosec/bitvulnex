#!/bin/sh
# V-34 pool watchdog — debounced auto-healer for the `web-api` replica pool.
#
# WHY: V-34 (prototype pollution via /api/v1/internal/trade-debug/replay)
# poisons whichever replica it lands on; a sprayed payload poisons the whole
# pool and every DB-backed route 500s/hangs with no self-recovery, silently
# eating an automated pentest's time budget. `.next` is on tmpfs (see the
# `tmpfs:` block in docker-compose.yml), so a `docker restart` wipes the
# poisoned webpack cache and the replica comes back clean in ~5-6s.
#
# This script polls each replica on its OWN 127.0.0.1:3000 (bypassing nginx,
# so the check is per-process not round-robined) and restarts one ONLY after
# it fails FAIL_THRESHOLD consecutive polls — so a one-off blip or a
# mid-compile 500 never triggers a bounce, but a real poisoning (which never
# recovers on its own) always does.
#
# POSIX sh on purpose: runs unchanged as a docker-compose sidecar on the
# `docker:cli` (busybox) image AND on the host via `make watchdog`.
#
# Env knobs (all optional):
#   WATCHDOG_INTERVAL         seconds between polls               (default 10)
#   WATCHDOG_FAIL_THRESHOLD   consecutive fails before restart    (default 3)
#   WATCHDOG_PROBE_TIMEOUT    per-probe deadline, seconds         (default 8)
#   WATCHDOG_WARM             1 = pre-compile hot routes on a healed replica (default 1)
#   WATCHDOG_PROJECT          compose project to scope to (default: auto-detect)
#   WATCHDOG_ONCE             1 = run a single pass and exit (for tests)
set -u

INTERVAL="${WATCHDOG_INTERVAL:-10}"
THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-3}"
PROBE_TIMEOUT="${WATCHDOG_PROBE_TIMEOUT:-8}"
WARM="${WATCHDOG_WARM:-1}"
STATE="${TMPDIR:-/tmp}/web-watchdog"
mkdir -p "$STATE"

# Scope STRICTLY to this compose project's web-api replicas. A bare name
# grep would also match other projects (e.g. vulnkeep-backend-web-1) — we
# must never restart those. Auto-detect the project from our own container
# labels when running as the sidecar; fall back to env, then to bitvulnex.
PROJECT="${WATCHDOG_PROJECT:-}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(docker inspect "$(hostname)" \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)"
fi
[ -z "$PROJECT" ] && PROJECT="bitvulnex"

ts() { date '+%H:%M:%S'; }
log() { echo "[$(ts)] $*"; }

# Only `web-api` replicas are auto-restarted. The pinned `web` (pages/HMR)
# is never poisoned by V-34 (the attack lands on /api/ → the pool) and must
# not be bounced, so it is deliberately excluded here.
replicas() {
  docker ps \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=web-api" \
    --format '{{.Names}}' | sort
}

# Probe a container's own app port. Echoes an HTTP status, "HANG" on a
# probe that exceeds the deadline (pollution can wedge Prisma for minutes),
# or "ERR"/"DEAD" when unreachable. 401 is the only healthy answer (bad
# creds on a live DB route).
PROBE_JS='fetch("http://127.0.0.1:3000/api/v2/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"watchdog@example.test",password:"x"}),signal:AbortSignal.timeout('"$((PROBE_TIMEOUT * 1000))"')}).then(function(r){console.log(r.status)}).catch(function(e){console.log(e.name==="TimeoutError"||e.name==="AbortError"?"HANG":"ERR")})'
probe() {
  out="$(timeout "$((PROBE_TIMEOUT + 4))" docker exec "$1" node -e "$PROBE_JS" 2>/dev/null)"
  [ -z "$out" ] && out="HANG"
  echo "$out"
}

warm() {
  for r in /api/health /api/v2/me /api/v2/me/flags /api/v2/me/orders \
           /api/v2/me/deposits /api/v2/me/withdrawals /api/v2/public/markets; do
    timeout 30 docker exec "$1" node -e \
      'fetch("http://127.0.0.1:3000'"$r"'",{signal:AbortSignal.timeout(25000)}).catch(function(){})' \
      >/dev/null 2>&1
  done
}

# Restart a batch of poisoned replicas in parallel, then verify each.
# Parallel (not one-at-a-time) so a fully-poisoned pool recovers in the
# time of ONE restart (~15s) rather than N×.
heal_batch() {
  # $* = container names. All already threshold-confirmed poisoned.
  safe=""
  for c in "$@"; do
    # Belt-and-suspenders: never restart anything that is not this
    # project's web-api-N, even though the label filter guarantees it.
    case "$c" in
      "${PROJECT}"-web-api-[0-9]*) safe="$safe $c" ;;
      *) log "REFUSING to restart unexpected container: $c" ;;
    esac
  done
  [ -z "$safe" ] && return
  log "  -> restarting$safe (each failed ${THRESHOLD} consecutive polls)"
  # shellcheck disable=SC2086
  docker restart $safe >/dev/null 2>&1
  for c in $safe; do
    i=0; ok=0
    while [ "$i" -lt 25 ]; do
      [ "$(probe "$c")" = "401" ] && { ok=1; break; }
      i=$((i + 1)); sleep 1
    done
    if [ "$ok" = "1" ]; then
      if [ "$WARM" = "1" ]; then warm "$c"; fi
      log "     $c back and healthy"
    else
      log "     $c did NOT recover after restart — check its logs"
    fi
    rm -f "$STATE/$c"
  done
}

pass() {
  found="$(replicas)"
  if [ -z "$found" ]; then
    log "no ${PROJECT} web-api replicas found (is the stack up?)"
    return
  fi
  toheal=""
  for c in $found; do
    s="$(probe "$c")"
    cf="$STATE/$c"
    if [ "$s" = "401" ]; then
      # healthy — clear any accumulated strikes
      rm -f "$cf"
    else
      n=$(( $(cat "$cf" 2>/dev/null || echo 0) + 1 ))
      echo "$n" > "$cf"
      log "$c unhealthy ($s) — strike ${n}/${THRESHOLD}"
      [ "$n" -ge "$THRESHOLD" ] && toheal="$toheal $c"
    fi
  done
  # shellcheck disable=SC2086
  [ -n "$toheal" ] && heal_batch $toheal
}

log "web-api watchdog: project=${PROJECT} interval=${INTERVAL}s threshold=${THRESHOLD} probe_timeout=${PROBE_TIMEOUT}s"
if [ "${WATCHDOG_ONCE:-0}" = "1" ]; then
  pass
  exit 0
fi
while true; do
  pass
  sleep "$INTERVAL"
done
