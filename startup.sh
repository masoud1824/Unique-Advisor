#!/bin/sh
if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
  exit 0
fi
cd /workspace
ISOLATED_DIR="/workspace/.preview-data/pglite-isolated-test-20261118"
if [ ! -f "$ISOLATED_DIR/global/pg_control" ]; then
  echo "isolated test database is missing" >&2
  exit 1
fi
export UA_ISOLATED_TEST=1
export PGLITE_DATA_DIR="$ISOLATED_DIR"
unset DATABASE_URL
npm run dev > /tmp/dev-server.log 2>&1 &
