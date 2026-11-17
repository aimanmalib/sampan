#!/usr/bin/env bash
# Rebuilds web/public/vendor/atom-client-<short commit>.min.js, the atomic swap route's client, from the commit named in
# config/sampan.json (atom.clientCommit) of the sampan-atom repository.
#
#   bash tools/atom/build-client.sh <path to a sampan-atom clone> [output file]
#
# Steps: (1) git archive of that commit into an empty temporary folder, npm ci --ignore-scripts, npm run build:client;
# (2) minify dist-client/atom-client.js with the esbuild version locked in that commit; (3) rewrite the libauth
# error-enum property writes that secret scanners read as generic API keys into bracket form (same JavaScript meaning),
# refusing any other count; (4) check the output: more than 1000 bytes per line, contains the AtomLock address from
# config, parses (node --check) and imports in Node with the client's exports. The temporary folder is removed on exit.
# Prints the esbuild version and the sha256 of the result; atom.clientSha256 in config must equal that sha256.
set -euo pipefail

ATOM_REPO=${1:?usage: build-client.sh <path to a sampan-atom clone> [output file]}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ATOM_REPO=$(cd "$ATOM_REPO" && pwd)
COMMIT=$(node -p 'require(process.argv[1]).atom.clientCommit' "$ROOT/config/sampan.json")
LOCK=$(node -p 'require(process.argv[1]).atom.atomLock' "$ROOT/config/sampan.json")
OUT=${2:-$ROOT/web/public/vendor/atom-client-${COMMIT:0:7}.min.js}
# The minified libauth enums carry three such writes (measured at 1b6c6f7: two are flagged by gitleaks generic-api-key,
# the third has the same shape and is rewritten too); any other count means the input changed.
EXPECTED_REWRITES=3

# git hooks export GIT_DIR and friends; they must not point the archive at another repository.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "build-client: commit $COMMIT"
git -C "$ATOM_REPO" archive "$COMMIT" | tar -x -C "$WORK"
(cd "$WORK" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null && npm run --silent build:client >/dev/null)
test -s "$WORK/dist-client/atom-client.js"

ESBUILD_VERSION=$(cd "$WORK" && npx --no-install esbuild --version)
echo "build-client: esbuild $ESBUILD_VERSION"
(cd "$WORK" && npx --no-install esbuild dist-client/atom-client.js --minify --format=esm --target=es2022 --log-level=warning --outfile=min.js)

node - "$WORK/min.js" "$EXPECTED_REWRITES" <<'JS'
const fs = require('fs');
const [file, expected] = process.argv.slice(2);
const pattern = /",([A-Za-z_$][\w$]*)\.(insufficientLength|unexpectedElse)="/g;
const text = fs.readFileSync(file, 'utf8');
let count = 0;
const out = text.replace(pattern, (_m, id, prop) => {
  count += 1;
  return `",${id}["${prop}"]="`;
});
if (count !== Number(expected)) {
  console.error(`build-client: expected ${expected} enum writes to rewrite, found ${count}`);
  process.exit(1);
}
fs.writeFileSync(file, out);
JS

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-git --no-banner --log-level=warn ${GITLEAKS_CONFIG:+--config "$GITLEAKS_CONFIG"} --source "$WORK/min.js" >/dev/null
  echo "build-client: gitleaks found nothing"
else
  echo "build-client: gitleaks not installed, scan skipped"
fi

node - "$WORK/min.js" "$LOCK" <<'JS'
const fs = require('fs');
const [file, lock] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n').length;
const perLine = Buffer.byteLength(text) / lines;
if (perLine <= 1000) throw new Error(`build-client: ${perLine.toFixed(0)} bytes per line, expected more than 1000`);
if (!text.toLowerCase().includes(lock.toLowerCase())) throw new Error('build-client: AtomLock address from config not in the build');
console.log(`build-client: ${Buffer.byteLength(text)} bytes, ${lines} lines, ${perLine.toFixed(0)} bytes per line`);
JS
cp "$WORK/min.js" "$WORK/import.mjs"
node --check "$WORK/import.mjs"
node --input-type=module -e "const m = await import(process.argv[1]); const names = Object.keys(m); if (names.length === 0) throw new Error('no exports'); console.log('build-client: exports ' + names.length);" "$WORK/import.mjs"

mkdir -p "$(dirname "$OUT")"
cp "$WORK/min.js" "$OUT"
echo "build-client: wrote $(basename "$OUT") sha256 $(sha256sum "$OUT" | cut -d' ' -f1)"
