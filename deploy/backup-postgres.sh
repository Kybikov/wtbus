#!/usr/bin/env sh

# Creates a compressed PostgreSQL dump from the production Compose service.
# Run from any directory: sh deploy/backup-postgres.sh /secure/backups/vivat-YYYYMMDD.dump
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sh deploy/backup-postgres.sh /absolute/path/to/vivat-YYYYMMDD.dump" >&2
  exit 64
fi

output_path=$1
case "$output_path" in
  /*) ;;
  *)
    echo "Use an absolute output path outside the deployment directory." >&2
    exit 64
    ;;
esac

if [ -e "$output_path" ]; then
  echo "Refusing to overwrite existing backup: $output_path" >&2
  exit 73
fi

output_directory=$(dirname -- "$output_path")
if [ ! -d "$output_directory" ]; then
  echo "Backup directory does not exist: $output_directory" >&2
  exit 66
fi

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -f "$project_root/.env.production" ]; then
  echo "Missing $project_root/.env.production" >&2
  exit 78
fi

cd "$project_root"
umask 077
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml exec -T postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$output_path"

if [ ! -s "$output_path" ]; then
  rm -f -- "$output_path"
  echo "Backup command produced an empty file." >&2
  exit 74
fi

echo "PostgreSQL backup created: $output_path"
