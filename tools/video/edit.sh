#!/usr/bin/env bash
# Cuts the demo video from the raw clips (tools/video/edit.ts has the steps). Output paths are arguments:
#   tools/video/edit.sh --out <file.mp4> [--captions <scenes.json>] [--report <file.json>] [--clips state/video] [--work state/video/edit] [--key-file <env file>] [--no-voice]
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed" >&2; exit 1; }
exec npx tsx tools/video/edit.ts "$@"
