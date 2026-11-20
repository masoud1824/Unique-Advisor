#!/bin/sh
# Isolated dev server. Refuses the acceptance desk. Not started by the feature task.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PORT="${UA_RELEASE_PORT:-8092}"
if [ "$PORT" = "8080" ]; then
  echo "Refusing port 8080." >&2
  exit 2
fi
case "${PGLITE_DATA_DIR:-}" in
  /workspace/.preview-data/*|"")
    echo "Set PGLITE_DATA_DIR under /opt/ua-release/data. The acceptance database is refused." >&2
    exit 2
    ;;
esac
case "${UA_RELEASE_ENV:-}" in
  development|staging) ;;
  *)
    echo "Set UA_RELEASE_ENV to development or staging." >&2
    exit 2
    ;;
esac
export UA_RELEASE_HOST="${UA_RELEASE_HOST:-127.0.0.1}"
exec node scripts/with-app-env.mjs node_modules/vite/bin/vite.js dev
