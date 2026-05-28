#!/usr/bin/env bash
# Lab stub for `pdftk` referenced by the compliance PDF export route.
# Real production would invoke the actual pdftk binary; the lab swaps
# in a no-op that writes a stub file so happy-path tests pass without
# the toolchain on PATH.
set -e

OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      shift
      OUT="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$OUT" ]]; then
  echo "PDF stub" > "$OUT"
fi
exit 0
