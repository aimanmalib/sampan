#!/usr/bin/env bash
# Uptime watch for the Sampan container (run from cron every 5 minutes on the host).
# GET / and /healthz through the public URL. Two failures in a row = one "unhealthy" alert; recovery = one
# info line. Alert text = lang/<UPTIME_LANG>.json keys alerts.unhealthy / alerts.recovered. At most one alert
# of each text per UTC day.
# Host values come from deploy/hos.env (SAMPAN_DOMAIN, NOTIFY_CMD). State: deploy/.uptime-state (not tracked).
# Test overrides: UPTIME_URL, UPTIME_STATE, UPTIME_NOTIFY, UPTIME_NOW (epoch seconds), UPTIME_LANG, UPTIME_CONTAINER,
# UPTIME_TIMEOUT (seconds per request).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck disable=SC1091
[ -r "$ROOT/deploy/hos.env" ] && . "$ROOT/deploy/hos.env"
URL=${UPTIME_URL:-https://${SAMPAN_DOMAIN:-localhost}}
STATE=${UPTIME_STATE:-$ROOT/deploy/.uptime-state}
NOTIFY=${UPTIME_NOTIFY:-${NOTIFY_CMD:-}}
NOW=${UPTIME_NOW:-$(date +%s)}
LANG_FILE=$ROOT/lang/${UPTIME_LANG:-ms}.json
CONTAINER=${UPTIME_CONTAINER:-sampan}
DAY=$(date -u -d "@$NOW" +%F)

# State: line 1 = "<up|down> <failures>", then "sent <day> <hash>" lines for today.
prev=up; fails=0
if [ -f "$STATE" ]; then read -r prev fails < <(head -1 "$STATE"); fi
[[ "${prev:-}" =~ ^(up|down)$ ]] || prev=up
[[ "${fails:-}" =~ ^[0-9]+$ ]] || fails=0
sent=$(grep "^sent $DAY " "$STATE" 2>/dev/null || true)

text_for() {  # $1 = key in the language file (flat keys)
  node -e 'try{const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];if(typeof t==="string")process.stdout.write(t)}catch(e){}' \
    "$LANG_FILE" "$1" 2>/dev/null
}

send() {  # $1 text, $2 level; once per text per UTC day
  local h; h=$(printf '%s' "$1" | md5sum | cut -c1-16)
  grep -q " $h\$" <<< "$sent" && return 0
  sent=$(printf '%s\nsent %s %s' "$sent" "$DAY" "$h")
  [ -n "$NOTIFY" ] && NOTIFY_KOD_KELUAR=1 $NOTIFY "$1" "$2" >/dev/null 2>&1
  return 0
}

bad=""
for p in / /healthz; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -m "${UPTIME_TIMEOUT:-25}" "$URL$p" || true)
  [ "${c:-000}" = 200 ] || bad="$bad $p=${c:-000}"
done
ctr=$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null) || ctr=missing

if [ -z "$bad" ]; then
  if [ "$prev" = down ]; then t=$(text_for alerts.recovered); send "${t:-Sampan recovered.} ($URL)" info; fi
  prev=up; fails=0
else
  fails=$((fails + 1))
  if [ "$fails" -ge 2 ] && [ "$prev" = up ]; then
    t=$(text_for alerts.unhealthy); send "${t:-Sampan is unhealthy.} ($URL:$bad; container $ctr)" warn
    prev=down
  fi
fi

{ echo "$prev $fails"; grep . <<< "$sent" || true; } > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
exit 0
