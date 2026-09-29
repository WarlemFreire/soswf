#!/usr/bin/env python3
"""Valida todo XML do projeto Android.

Existe porque isto ja quebrou o build duas vezes pelo mesmo motivo: XML proibe
"--" dentro de comentario, e um travessao escrito sem pensar derruba a
compilacao dos recursos antes mesmo de o Java ser compilado. O erro so aparecia
no CI, minutos depois do push.

Uso:  python3 nativo/scripts/validar-xml.py
"""
import glob
import sys
import xml.dom.minidom
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main"


def main():
    if not RAIZ.is_dir():
        # Sem projeto Android por perto nao ha o que validar.
        return 0

    ruins = 0
    for caminho in sorted(glob.glob(str(RAIZ / "**" / "*.xml"), recursive=True)):
        try:
            xml.dom.minidom.parse(caminho)
        except Exception as erro:
            print(f"FALHOU: {caminho}\n  {erro}")
            ruins += 1
    return 1 if ruins else 0


if __name__ == "__main__":
    sys.exit(main())
