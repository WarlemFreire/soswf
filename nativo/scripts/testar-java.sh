#!/usr/bin/env bash
# Roda os testes do Java PURO -- hoje, o parser da oferta.
#
# Oferta.java nao importa nada de Android justamente para caber aqui: e o
# arquivo onde mora toda a fragilidade do semaforo, e o unico jeito de
# consertar parser sem aparelho na mao e ter onde rodar o texto de verdade.
set -u
# O JAVA_TOOL_OPTIONS deste contêiner imprime um parágrafo a cada chamada.
unset JAVA_TOOL_OPTIONS
raiz="$(cd "$(dirname "$0")/.." && pwd)"
fonte="$raiz/android/app/src/completo/java/com/soswf/copiloto"
testes="$raiz/testes"

command -v javac >/dev/null 2>&1 || { echo "sem javac; pulando testes de java"; exit 0; }

# O dublê de Pisos so pode declarar o que o Pisos de verdade tem. Sem esta
# conferencia, o teste passaria contra uma classe que nao existe mais.
real="$fonte/Pisos.java"
faltando=""
for membro in pisoHora idealHora otimoHora pisoKm custoKm temFaixaDeHora; do
  grep -q "\b$membro\b" "$real" || faltando="$faltando $membro"
done
if [ -n "$faltando" ]; then
  echo "✗ o dublê de Pisos declara o que o Pisos real não tem:$faltando"
  exit 1
fi

saida="$(mktemp -d)"
trap 'rm -rf "$saida"' EXIT

if ! javac -nowarn -encoding UTF-8 -d "$saida" \
     "$fonte/Oferta.java" \
     "$testes/stub/com/soswf/copiloto/Pisos.java" \
     "$testes/com/soswf/copiloto/OfertaTeste.java" 2>&1; then
  echo "✗ não compilou"
  exit 1
fi

java -cp "$saida" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 com.soswf.copiloto.OfertaTeste
