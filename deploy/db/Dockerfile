# PostgreSQL 17 avec pgBackRest (archivage WAL continu, restauration à un instant donné).
FROM postgres:17.6
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/pgbackrest /var/lib/pgbackrest /var/spool/pgbackrest \
 && chown -R postgres:postgres /var/log/pgbackrest /var/lib/pgbackrest /var/spool/pgbackrest
