#!/bin/sh
# Sintaxe de todos os modulos + testes. sh os/test/check.sh
set -e
dir="$(dirname "$0")/.."
tmp=$(mktemp -d)
for f in "$dir"/js/*.js "$dir"/sw.js; do
  cp "$f" "$tmp/$(basename "$f" .js).mjs"
  node --check "$tmp/$(basename "$f" .js).mjs" || { echo "FALHOU: $f"; exit 1; }
done
rm -rf "$tmp"
echo "sintaxe ok"
for s in "$dir"/test/*.test.mjs; do node "$s"; done
