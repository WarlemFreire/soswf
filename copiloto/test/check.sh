#!/bin/sh
# Checa a sintaxe de todos os modulos ES do app (node --check so trata .js como
# CommonJS, entao copiamos para .mjs antes de checar).
set -e
tmp=$(mktemp -d)
erros=0
for f in $(find "$(dirname "$0")/.." -name '*.js' -not -path '*/test/*'); do
  cp "$f" "$tmp/$(basename "$f" .js).mjs"
  if ! node --check "$tmp/$(basename "$f" .js).mjs"; then
    echo "FALHOU: $f"
    erros=1
  fi
done
rm -rf "$tmp"
[ "$erros" != 0 ] && exit 1

echo "sintaxe ok"

for v in validar-xml.py validar-plugincall.py validar-gradle.py; do
  validador="$(dirname "$0")/../../nativo/scripts/$v"
  if [ -f "$validador" ] && command -v python3 >/dev/null 2>&1; then
    python3 "$validador" || erros=1
  fi
done
for suite in "$(dirname "$0")"/*.test.mjs; do
  node "$suite" || erros=1
done
exit $erros
