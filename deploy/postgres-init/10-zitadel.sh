#!/bin/sh
# Premier démarrage seulement (volume vide) : rôle et base dédiés à Zitadel, sans superutilisateur.
set -eu
: "${ZITADEL_DB_PASSWORD:?ZITADEL_DB_PASSWORD requis (deploy/zitadel.env)}"
psql -v ON_ERROR_STOP=1 -v pw="$ZITADEL_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE zitadel LOGIN PASSWORD :'pw';
CREATE DATABASE zitadel OWNER zitadel;
SQL
