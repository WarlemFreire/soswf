#!/usr/bin/env bash
# Processa os itens pendentes em lotes, com pausa longa entre eles.
# Para na hora se o Instagram mostrar aviso/verificacao ou a sessao cair.
#   BATCH=100 PAUSE=1800 MAX_BATCHES=10 bash ig_run_batches.sh
set -u
BATCH=${BATCH:-100}      # itens por lote
PAUSE=${PAUSE:-1800}     # segundos de pausa entre lotes
MAX_BATCHES=${MAX_BATCHES:-10}
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${IG_OUT_DIR:-$HOME/work/ig}"
cd "$DIR"

pending() {
  python3 - "$OUT" <<'EOF'
import json, sys
d = sys.argv[1]
def rows(p):
    try: return [json.loads(l) for l in open(p) if l.strip()]
    except FileNotFoundError: return []
done = {r["code"] for r in rows(d + "/catalog.jsonl") if r.get("ok")}
print(sum(1 for r in rows(d + "/saved_links.jsonl") if r["code"] not in done))
EOF
}

for i in $(seq 1 "$MAX_BATCHES"); do
  left=$(pending)
  echo "$(date +%T) lote $i/$MAX_BATCHES - pendentes: $left"
  [ "$left" -eq 0 ] && { echo "$(date +%T) tudo processado."; exit 0; }
  node ig_fetch.js --limit "$BATCH" --min 8 --max 20
  code=$?
  if [ "$code" -eq 7 ] || [ "$code" -eq 4 ]; then
    echo "$(date +%T) PARADO (codigo $code): o Instagram mostrou um aviso/verificacao ou a sessao caiu. Nada mais foi tentado."
    exit "$code"
  fi
  if [ "$code" -ne 0 ]; then echo "$(date +%T) erro (codigo $code); parando."; exit "$code"; fi
  left=$(pending)
  [ "$left" -eq 0 ] && { echo "$(date +%T) tudo processado."; exit 0; }
  echo "$(date +%T) pausa de $((PAUSE / 60)) min antes do proximo lote (restam $left)"
  sleep "$PAUSE"
done
echo "$(date +%T) limite de lotes atingido."
