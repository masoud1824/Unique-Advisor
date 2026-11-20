#!/bin/sh
# Roll the release copy back to the acceptance source tag.
# Default is dry-run. This script refuses the acceptance tree and its databases.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
TAG="${UA_RELEASE_TAG:-acceptance-20261119-2232}"
DRY="${UA_RELEASE_ROLLBACK_CONFIRM:-dry-run}"
case "$ROOT" in
  /workspace|/workspace/*)
    echo "Refusing to roll back the acceptance source tree." >&2
    exit 2
    ;;
esac
for blocked in \
  /workspace/.preview-data/pglite-isolated-test-20261118 \
  /workspace/.preview-data/pglite-untouched-20261119 \
  /workspace/.preview-data/pglite \
  /workspace/.preview-data/pglite-work
do
  case "${PGLITE_DATA_DIR:-}" in
    "$blocked"|"$blocked"/*)
      echo "Refusing to touch $PGLITE_DATA_DIR" >&2
      exit 2
      ;;
  esac
done
cd "$ROOT"
echo "Repository: $ROOT"
echo "Tag: $TAG"
git rev-parse "$TAG^{commit}"
echo "Current: $(git rev-parse --abbrev-ref HEAD) $(git rev-parse --short HEAD)"
if [ "$DRY" != "yes" ]; then
  echo "Dry run only. No files were changed. Set UA_RELEASE_ROLLBACK_CONFIRM=yes to reset this copy to the tag."
  exit 0
fi
git reset --hard "$TAG"
echo "Reset this copy to $TAG. The acceptance desk was not modified."
echo "A code reset does not undo a database migration. Restoring a backup can lose writes made after that backup."
