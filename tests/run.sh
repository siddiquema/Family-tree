#!/usr/bin/env bash
# Builds a fresh database from the migrations for each tests/*.test.sql file and runs it.
# Needs a local PostgreSQL 15+; set PGHOST/PGPORT/PGUSER as usual. Usage: tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-family_tree_test}"

build() {
  psql -qX -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
  psql -qX -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f tests/supabase_shim.sql
  for f in supabase/migrations/*.sql; do psql -qX -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f "$f"; done
}

for t in tests/*.test.sql; do
  build
  echo "$(basename "$t")"
  psql -qX -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f "$t" 2>&1 | sed -E 's/^.*(NOTICE|ERROR): +/  /' | grep -v '^\s*$'
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "tests failed"; exit 1; }
done
echo "all tests passed"
