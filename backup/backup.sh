#!/bin/sh
# Sauvegarde de la base cortège (pg_dump, format personnalisé compressé) vers /backups,
# puis purge des sauvegardes plus anciennes que BACKUP_KEEP_DAYS.
# Lancé chaque jour par crond (voir le service « backup » de docker-compose.yml) ou à la main :
#   docker compose run --rm backup /usr/local/bin/backup.sh
set -eu

# Sous crond, l'environnement du conteneur n'est pas transmis : il est enregistré au démarrage.
[ -f /etc/cortege-backup.env ] && . /etc/cortege-backup.env

dir=/backups
keep="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date +%Y%m%d-%H%M%S)"
file="$dir/cortege-$stamp.dump"

mkdir -p "$dir"
echo "[$(date -Iseconds)] Sauvegarde de ${PGDATABASE:-cortege} vers $file"
# Écriture dans un fichier temporaire d'abord : pas de sauvegarde tronquée en cas d'échec.
pg_dump -Fc -f "$file.part"
mv "$file.part" "$file"

# Purge des anciennes sauvegardes (rétention en jours).
find "$dir" -maxdepth 1 -name 'cortege-*.dump' -type f -mtime "+$keep" -delete 2>/dev/null || true

echo "[$(date -Iseconds)] Terminé : $(du -h "$file" | cut -f1) ($(find "$dir" -maxdepth 1 -name 'cortege-*.dump' | wc -l) sauvegarde(s) conservée(s))"
