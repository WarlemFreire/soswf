#!/usr/bin/env python3
"""Pega a armadilha de precedencia do `as` nos arquivos .gradle.

Em Groovy o operador `as` tem precedencia MENOR que a chamada de metodo sem
parenteses. Entao isto:

    versionCode (System.getenv("VERSION_CODE") ?: "1") as int

nao converte o argumento: converte o RETORNO. O que chega no DSL e a String
"26", e o build morre com "Value is null" -- uma mensagem que nao aponta para
nada parecido com a causa. Custou uma execucao inteira do CI.

A forma correta e explicita:

    versionCode Integer.parseInt(System.getenv("VERSION_CODE") ?: "1")

Uso:  python3 nativo/scripts/validar-gradle.py
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Uma chamada de DSL sem parenteses (nome seguido de espaco e abre-parentese)
# cujo fechamento e seguido de ` as <tipo>`.
SUSPEITO = re.compile(r"^\s*([a-z]\w*)\s+\(.*\)\s+as\s+\w+", re.MULTILINE)

# `def x = (...) as int` e legitimo: ali o `as` se aplica a uma atribuicao, nao
# ao argumento de um metodo.
ATRIBUICAO = re.compile(r"^\s*(def\s|\w+\s*=)")


def main():
    problemas = []
    for arquivo in sorted(RAIZ.rglob("*.gradle")):
        if "node_modules" in arquivo.parts or "build" in arquivo.parts:
            continue
        texto = arquivo.read_text(encoding="utf-8")
        for linha_n, linha in enumerate(texto.splitlines(), 1):
            sem_comentario = linha.split("//")[0]
            if ATRIBUICAO.match(sem_comentario):
                continue
            if SUSPEITO.match(sem_comentario):
                problemas.append(
                    f"{arquivo.relative_to(RAIZ)}:{linha_n}: {sem_comentario.strip()}"
                )

    if problemas:
        print("gradle: `as` depois de chamada sem parenteses converte o RETORNO,")
        print("nao o argumento. Use a conversao explicita (Integer.parseInt, etc.):")
        for p in problemas:
            print(f"  {p}")
        return 1

    print("gradle ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
