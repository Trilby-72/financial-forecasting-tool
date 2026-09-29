#!/usr/bin/env sh
set -eu

if [ -n "${SQLITE_DB_PATH:-}" ]; then
  database_dir=$(dirname "$SQLITE_DB_PATH")
  mount_marker="${SQLITE_DB_MOUNT_MARKER:-$database_dir/.azure-files-ready}"
  attempts=0
  while { [ ! -f "$mount_marker" ] || [ ! -f "$SQLITE_DB_PATH" ]; } && [ "$attempts" -lt 60 ]; do
    attempts=$((attempts + 1))
    sleep 2
  done

  if [ ! -f "$mount_marker" ] || [ ! -f "$SQLITE_DB_PATH" ]; then
    echo "Azure Files database mount was not ready at $database_dir" >&2
    exit 1
  fi
fi

exec npm start
