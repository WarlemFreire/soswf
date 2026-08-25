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
[ "$erros" = 0 ] && echo "sintaxe ok"
exit $erros
