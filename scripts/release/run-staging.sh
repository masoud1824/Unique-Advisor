#!/bin/sh
# One staging process. Records its own pid, then becomes the server.
# Stop only that pid after checking the command line. Never signal other processes.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p /opt/ua-release/run /opt/ua-release/logs
case "$ROOT" in
  /workspace|/workspace/*)
    echo "Refusing to start staging from the acceptance tree." >&2
    exit 2
    ;;
esac
export UA_RELEASE_ENV=staging
export UA_RELEASE_PORT=8093
export UA_RELEASE_HOST=127.0.0.1
export UA_RELEASE_DATA_ROOT=/opt/ua-release/data
export PGLITE_DATA_DIR=/opt/ua-release/data/staging-review
export UA_RELEASE_CACHE=/opt/ua-release/cache/staging-review
export UA_OUTBOUND_BLOCK=1
unset DATABASE_URL
unset UA_BIRTHDAY_LIVE
unset UA_BIRTHDAY_EXECUTE
unset UA_ISOLATED_TEST
if [ -f /opt/ua-release/run/staging-operator.password ]; then
  # shellcheck disable=SC2162
  IFS= read -r PREVIEW_OPERATOR_PASSWORD < /opt/ua-release/run/staging-operator.password
  export PREVIEW_OPERATOR_PASSWORD
fi
echo $$ > /opt/ua-release/run/staging.pid
exec >> /opt/ua-release/logs/staging-review.log 2>&1
exec "$ROOT/scripts/release/start-isolated.sh"
