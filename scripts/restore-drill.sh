#!/usr/bin/env bash
# Exercice de restauration mensuel (lot 1, ADR 0009), sur la machine « backup ».
# Restaure la dernière sauvegarde pgBackRest dans un conteneur temporaire, attend PostgreSQL,
# exécute deploy/db/drill-checks.sql, publie le résultat pour la supervision (fichier texte lu
# par node-exporter), puis supprime tout. Aucune donnée ne quitte la machine.
# Usage : scripts/restore-drill.sh [cible PITR, ex. "2026-12-01 10:00:00+01"]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
NAME="duoshop-restore-drill-$(date +%s)"
VOLUME="${NAME}-data"
METRICS_DIR="${METRICS_DIR:-/var/lib/node_exporter/textfile}"
started=$(date +%s)

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

publish() {
  local ok="$1"
  mkdir -p "$METRICS_DIR"
  {
    echo "# TYPE duoshop_restore_drill_success gauge"
    echo "duoshop_restore_drill_success ${ok}"
    echo "# TYPE duoshop_restore_drill_timestamp_seconds gauge"
    echo "duoshop_restore_drill_timestamp_seconds $(date +%s)"
    echo "# TYPE duoshop_restore_drill_duration_seconds gauge"
    echo "duoshop_restore_drill_duration_seconds $(( $(date +%s) - started ))"
  } > "${METRICS_DIR}/restore_drill.prom.tmp"
  mv "${METRICS_DIR}/restore_drill.prom.tmp" "${METRICS_DIR}/restore_drill.prom"
}
trap 'publish 0' ERR

restore_args=(--stanza=duoshop --delta)
if [ -n "$TARGET" ]; then
  restore_args+=(--type=time "--target=${TARGET}")
fi

docker volume create "$VOLUME" >/dev/null
docker run --rm \
  --env-file "${ROOT}/deploy/backup.env" \
  -v "${VOLUME}:/var/lib/postgresql/data" \
  -v "${ROOT}/deploy/db/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  -v "${ROOT}/deploy/tls/ca.crt:/etc/pgbackrest/backup-ca.crt:ro" \
  --user postgres duoshop-db:latest \
  pgbackrest "${restore_args[@]}" restore

docker run -d --name "$NAME" \
  -v "${VOLUME}:/var/lib/postgresql/data" \
  --user postgres duoshop-db:latest \
  postgres -c archive_mode=off -c listen_addresses='' >/dev/null

for _ in $(seq 1 120); do
  if docker exec "$NAME" pg_isready -q -d duoshop; then break; fi
  sleep 2
done

results="$(docker exec -i "$NAME" psql -At -d duoshop -U duoshop < "${ROOT}/deploy/db/drill-checks.sql")"
echo "$results"
if echo "$results" | grep -q '|fail'; then
  publish 0
  exit 1
fi
publish 1
echo "restore drill ok"
