#!/usr/bin/env bash
# Full gate: lint, types, unit tests, build, browser tests against fake providers. No external network.
set -euo pipefail
cd "$(dirname "$0")/.."

# Hooks export GIT_* pointing at the real repository; tests that run git in temp folders must not inherit them.
while IFS= read -r name; do unset "$name"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')

export SAMPAN_FAKE=1
export NO_COLOR=1

echo "== lint";      npm run -s lint
echo "== types";     npm run -s typecheck
echo "== unit";      npx vitest run --reporter=dot
echo "== build";     npm run -s build
if [ "${CI:-}" = "1" ]; then
  echo "== browsers"; npx playwright install --with-deps chromium webkit >/dev/null
fi
echo "== e2e";       npx playwright test
echo "gate ok"
