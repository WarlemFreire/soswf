#!/usr/bin/env bash
# Registra o pipeline das midias no cron do usuario atual (a cada 5 min, com flock: nunca roda em dobro).
# O cron roda fora do servico do MCP, entao reiniciar o servidor nao derruba o pipeline.
#   bash install_pipeline_cron.sh           instala
#   bash install_pipeline_cron.sh --remove  remove
set -eu
LINE="*/5 * * * * flock -n \$HOME/work/ig/.pipeline.lock \$HOME/tools/instagram/ig_media_pipeline.sh >> \$HOME/work/ig_media_pipeline.log 2>&1 # ig-media-pipeline"
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'ig-media-pipeline' > "$TMP" || true
if [ "${1:-}" != "--remove" ]; then echo "$LINE" >> "$TMP"; fi
crontab "$TMP"
rm -f "$TMP"
mkdir -p "$HOME/work/ig"
echo "cron atual:"; crontab -l | grep ig-media-pipeline || echo "(nenhuma entrada do pipeline)"
