#!/bin/sh
# Checa a sintaxe de todos os modulos ES do app (node --check so trata .js como
# CommonJS, entao copiamos para .mjs antes de checar).
#
# ESTE PORTAO JA FOI VAZIO. O find era
#     find "$(dirname "$0")/.." -name '*.js' -not -path '*/test/*'
# e, chamado de dentro de test/, o caminho expandido vira "./test/../js/x.js",
# que CONTEM "/test/" -- a exclusao apagava todos os arquivos. Ele imprimia
# "sintaxe ok" sem olhar um arquivo sequer, e foi assim que uma funcao
# declarada duas vezes passou daqui e so apareceu no navegador.
#
# Por isso a base e resolvida para caminho absoluto e, no fim, se nenhum arquivo
# foi checado, ISTO E UMA FALHA. Portao que nao acha nada nao esta passando:
# esta cego.
set -e
base=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
erros=0
vistos=0
for f in $(find "$base" -name '*.js' -not -path "$base/test/*"); do
  vistos=$((vistos + 1))
  cp "$f" "$tmp/$(basename "$f" .js).mjs"
  if ! node --check "$tmp/$(basename "$f" .js).mjs"; then
    echo "FALHOU: $f"
    erros=1
  fi
done
rm -rf "$tmp"
[ "$erros" != 0 ] && exit 1
if [ "$vistos" -lt 10 ]; then
  echo "FALHOU: o checador de sintaxe olhou $vistos arquivos; o app tem dezenas."
  exit 1
fi

echo "sintaxe ok ($vistos arquivos)"

for v in validar-xml.py validar-plugincall.py validar-gradle.py; do
  validador="$(dirname "$0")/../../nativo/scripts/$v"
  if [ -f "$validador" ] && command -v python3 >/dev/null 2>&1; then
    python3 "$validador" || erros=1
  fi
done
# O parser da oferta é Java, mas Java PURO: roda aqui, com texto de tela real.
java_sh="$(dirname "$0")/../../nativo/scripts/testar-java.sh"
[ -x "$java_sh" ] && { "$java_sh" || erros=1; }

for suite in "$(dirname "$0")"/*.test.mjs; do
  node "$suite" || erros=1
done
exit $erros
