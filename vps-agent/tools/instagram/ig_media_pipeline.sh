#!/usr/bin/env bash
# Pipeline das midias: baixa (como visitante) e transforma em texto (OCR + voz), em paralelo.
# Retomavel e a prova de reinicios: pensado para rodar pelo cron com flock (veja install_pipeline_cron.sh).
# Para tudo se o Instagram parecer bloquear (codigo 7 do ig_media.js).
set -u
export PATH=/usr/local/bin:/usr/bin:/bin
export HOME="${HOME:-/home/agente}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${IG_OUT_DIR:-$HOME/work/ig}"
PY="${PY:-/opt/vps-agent/venv/bin/python}"
THREADS="${THREADS:-3}"
cd "$DIR"
mkdir -p "$OUT"
STATUS="$OUT/media_pipeline.status"

log() { echo "$(date +%T) $*"; }

count() {  # count <links|dl_pending|proc_pending>
  "$PY" - "$OUT" "$1" <<'EOF'
import json, sys
d, what = sys.argv[1], sys.argv[2]
def rows(p):
    try: return [json.loads(l) for l in open(p) if l.strip()]
    except FileNotFoundError: return []
links = {r["code"] for r in rows(d + "/saved_links.jsonl")}
mani = rows(d + "/media_manifest.jsonl")
tried = {r["code"] for r in mani}
ok = {r["code"] for r in mani if r.get("embed_ok")}
proc = {r["code"] for r in rows(d + "/content.jsonl")}
print({"links": len(links), "dl_pending": len(links - tried), "proc_pending": len(ok - proc)}[what])
EOF
}

if [ "$(cat "$STATUS" 2>/dev/null)" = "done" ]; then log "ja concluido."; exit 0; fi
if [ "$(cat "$STATUS" 2>/dev/null)" = "blocked" ]; then log "PARADO antes por bloqueio. Apague $STATUS para tentar de novo."; exit 7; fi

# 1) nao competir com a coleta da conta (mesmo IP)
if [ "${WAIT_ACCOUNT_BATCH:-1}" = "1" ]; then
  while pgrep -u "$(id -u)" -f '[i]g_run_batches' >/dev/null || pgrep -u "$(id -u)" -f '[i]g_fetch.js' >/dev/null; do
    log "aguardando a coleta da conta terminar..."; sleep 120
  done
fi
log "inicio: $(count links) itens | download pendente: $(count dl_pending) | processamento pendente: $(count proc_pending)"

# 2) download em segundo plano (visitante, nao usa a conta)
DL_FLAG="$OUT/.download_finished"; rm -f "$DL_FLAG"
(
  while true; do
    node ig_media.js --limit 30 --min 8 --max 16; code=$?
    if [ "$code" -eq 7 ]; then echo blocked > "$STATUS"; touch "$DL_FLAG"; exit 7; fi
    if [ "$(count dl_pending)" -eq 0 ]; then touch "$DL_FLAG"; exit 0; fi
    [ "$code" -ne 0 ] && sleep 300 || sleep 90
  done
) &
DL_PID=$!

# 3) processamento (OCR + voz) enquanto o download continua
while true; do
  if [ "$(count proc_pending)" -gt 0 ]; then
    "$PY" media_to_text.py --dir "$OUT" --limit 20 --threads "$THREADS"
  elif [ -f "$DL_FLAG" ]; then
    break
  else
    sleep 60
  fi
  [ "$(cat "$STATUS" 2>/dev/null)" = "blocked" ] && break
done
wait "$DL_PID" 2>/dev/null

if [ "$(cat "$STATUS" 2>/dev/null)" = "blocked" ]; then log "PARADO: possivel bloqueio do Instagram no download."; exit 7; fi
log "fim: $(count proc_pending) pendentes no processamento"
[ "$(count proc_pending)" -eq 0 ] && echo done > "$STATUS"
