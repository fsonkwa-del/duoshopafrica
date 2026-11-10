#!/usr/bin/env bash
# Vérification depuis l'extérieur (lot 8) : seuls 80 et 443 (et 22 depuis les adresses
# autorisées) doivent répondre. À lancer depuis une machine hors du réseau privé.
# Usage : scripts/check-exposure-remote.sh <hôte>
set -euo pipefail
host="${1:?usage: check-exposure-remote.sh <host>}"
# PostgreSQL, SeaweedFS (S3, maître, filer), Zitadel, Redis, ClamAV, Docker, supervision.
forbidden=(5432 8333 9333 8888 8080 6379 3310 2375 2376 9090 9093 3000 3001 3100 9100)
status=0
for port in "${forbidden[@]}"; do
  if timeout 3 bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>/dev/null; then
    echo "OPEN (forbidden): ${host}:${port}"
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "exposure ok for ${host}"
exit "$status"
