#!/usr/bin/env python3
"""Valida todo XML do projeto Android.

Existe porque isto ja quebrou o build TRES vezes pelo mesmo motivo: XML proibe
"--" dentro de comentario, e um travessao escrito sem pensar derruba a
compilacao dos recursos antes mesmo de o Java ser compilado. O erro so aparecia
no CI, minutos depois do push.

Na terceira vez o portao estava aqui e DEIXOU PASSAR: ele olhava so src/main, e
o arquivo que quebra o build mora em src/completo. Gate que cobre meio caminho
da a mesma confianca de um que cobre tudo, e e por isso que custa mais caro --
eu confiei nele. Agora varre src/ inteiro, sabores inclusive.

Uso:  python3 nativo/scripts/validar-xml.py
"""
import glob
import sys
import xml.dom.minidom
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "android" / "app" / "src"


def main():
    if not RAIZ.is_dir():
        # Sem projeto Android por perto nao ha o que validar.
        return 0

    ruins = 0
    vistos = 0
    for caminho in sorted(glob.glob(str(RAIZ / "**" / "*.xml"), recursive=True)):
        vistos += 1
        try:
            xml.dom.minidom.parse(caminho)
        except Exception as erro:
            print(f"FALHOU: {caminho}\n  {erro}")
            ruins += 1

    if ruins:
        return 1
    # Dizer quantos foram olhados: um portao que nao acha arquivo nenhum
    # tambem "passa", e foi assim que este aqui enganou.
    print(f"xml ok ({vistos} arquivos)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
