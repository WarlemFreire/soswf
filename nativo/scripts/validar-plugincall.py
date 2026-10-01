#!/usr/bin/env python3
"""Confere que todo metodo de PluginCall usado no Java existe de verdade.

Existe porque isto ja quebrou o build duas vezes, e sempre do mesmo jeito: eu
escrevo um metodo que PARECE certo (getInteger, disableSelf devolvendo boolean),
e o erro so aparece no CI minutos depois. A assinatura real esta no fonte do
Capacitor, dentro de node_modules -- da para conferir aqui, de graca.

Uso:  python3 nativo/scripts/validar-plugincall.py
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
JAVA = RAIZ / "android" / "app" / "src"


def metodos_reais():
    fontes = list((RAIZ / "node_modules" / "@capacitor" / "android").rglob("PluginCall.java"))
    if not fontes:
        return None
    texto = fontes[0].read_text(encoding="utf-8")
    return set(re.findall(r"public\s+[\w<>?\[\]]+\s+(\w+)\s*\(", texto))


def main():
    reais = metodos_reais()
    if reais is None:
        print("PluginCall.java nao encontrado; pulando")
        return 0

    ruins = 0
    for arquivo in JAVA.rglob("*.java"):
        texto = arquivo.read_text(encoding="utf-8")
        # Variaveis declaradas como PluginCall neste arquivo.
        nomes = set(re.findall(r"PluginCall\s+(\w+)", texto))
        for nome in nomes:
            for metodo in set(re.findall(rf"\b{nome}\.(\w+)\s*\(", texto)):
                if metodo not in reais:
                    print(f"FALHOU: {arquivo.name}: PluginCall nao tem '{metodo}()'")
                    ruins += 1
    if not ruins:
        print("plugincall ok")
    return 1 if ruins else 0


if __name__ == "__main__":
    sys.exit(main())
