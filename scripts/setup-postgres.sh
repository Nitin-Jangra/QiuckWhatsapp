#!/usr/bin/env bash
# Creates (or updates) the PostgreSQL role and database named in .env's DATABASE_URL.
# Run once on the VPS from the app folder:  bash scripts/setup-postgres.sh
# Safe to re-run: existing role gets its password refreshed, existing database is left untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
[ -n "$URL" ] || { echo "DATABASE_URL not found in .env"; exit 1; }

# postgresql://user:pass@host:port/db
REST=${URL#*://}
CREDS=${REST%%@*}
DB_USER=${CREDS%%:*}
DB_PASS=${CREDS#*:}
DB_NAME=${REST##*/}
DB_NAME=${DB_NAME%%\?*}

for v in "$DB_USER" "$DB_NAME"; do
  [[ "$v" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Unsupported role/database name: $v"; exit 1; }
done
[[ "$DB_PASS" =~ ^[a-zA-Z0-9]+$ ]] || { echo "Password must be letters and digits only for this script"; exit 1; }

command -v psql >/dev/null || { echo "Installing PostgreSQL..."; sudo apt-get update -y && sudo apt-get install -y postgresql; }
sudo systemctl enable --now postgresql >/dev/null 2>&1 || true

sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

echo "PostgreSQL ready: database '${DB_NAME}' owned by '${DB_USER}' on this server."
echo "Tables are created automatically when the app starts."
