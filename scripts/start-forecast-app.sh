#!/usr/bin/env sh
set -eu

if [ -n "${SQLITE_DB_PATH:-}" ]; then
  attempts=0
  while [ ! -f "$SQLITE_DB_PATH" ] && [ "$attempts" -lt 60 ]; do
    attempts=$((attempts + 1))
    sleep 2
  done

  if [ ! -f "$SQLITE_DB_PATH" ]; then
    echo "SQLite database was not available at $SQLITE_DB_PATH" >&2
    exit 1
  fi
fi

exec npm start
