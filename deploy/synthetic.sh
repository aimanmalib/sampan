#!/usr/bin/env bash
# Synthetic monitor of the public site, run from the host's cron (see docs/OPERATIONS.md):
#   deploy/synthetic.sh          hourly probes (tools/synthetic/probe.ts)
#   deploy/synthetic.sh render   the front page in Chromium and WebKit iPhone 13 (e2e/front.spec.ts), twice a day
# Two failures in a row of one probe = one alert; recovery = one info line; each text at most once per UTC day.
# Host values come from deploy/hos.env (SAMPAN_DOMAIN, NOTIFY_CMD, SAMPAN_NODE = full path of a Node 22 binary,
# BROWSER_CMD). State: deploy/.synthetic-state (not tracked).
# Test overrides: SYNTHETIC_URL, SYNTHETIC_STATE, SYNTHETIC_NOTIFY, SYNTHETIC_NOW, SYNTHETIC_LANG, SYNTHETIC_TIMEOUT_MS,
# SYNTHETIC_ONLY (comma-separated probe names).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 0
# shellcheck disable=SC1091
[ -r deploy/hos.env ] && . deploy/hos.env
NODE=${SAMPAN_NODE:-$(command -v node)}
# Cron's PATH has the system node (too old); every node started below (tsx, npx, playwright) uses this one.
PATH="$(dirname "$NODE"):$PATH"; export PATH
export SYNTHETIC_URL=${SYNTHETIC_URL:-${SAMPAN_DOMAIN:+https://$SAMPAN_DOMAIN}}
NOTIFY=${SYNTHETIC_NOTIFY:-${NOTIFY_CMD:-}}
TSX=(node node_modules/tsx/dist/cli.mjs tools/synthetic/probe.ts)

if [ "${1:-}" = render ]; then
  log=$(mktemp)
  # shellcheck disable=SC2086
  if E2E_BASE_URL="$SYNTHETIC_URL" ${BROWSER_CMD:-} npx playwright test e2e/front.spec.ts --workers=1 --reporter=line >"$log" 2>&1; then
    out=$("${TSX[@]}" --record render=ok); rc=$?
  else
    out=$("${TSX[@]}" --record render=fail --detail "$(grep -m1 -E '[0-9]+ failed|Error' "$log" | sed 's/^ *//' | cut -c1-160)"); rc=$?
  fi
  rm -f "$log"
else
  out=$("${TSX[@]}" ${SYNTHETIC_ONLY:+--only "$SYNTHETIC_ONLY"}); rc=$?
fi
[ $rc -eq 0 ] || echo "synthetic: probe runner exited $rc" >&2

while IFS=$'\t' read -r tag level text; do
  [ "$tag" = ALERT ] || continue
  [ -n "$NOTIFY" ] && NOTIFY_KOD_KELUAR=1 $NOTIFY "$text" "$level" >/dev/null 2>&1
done <<< "$out"
grep '^{' <<< "$out" || true
exit 0
