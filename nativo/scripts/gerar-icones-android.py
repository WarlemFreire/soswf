#!/usr/bin/env python3
"""Gera os icones do APK a partir do MESMO desenho do icone do PWA.

Reaproveita copiloto/icons/gerar-icones.py -- nenhuma dependencia nova, e o
icone do app nativo nunca sai de sincronia com o da web.

Android pede duas coisas diferentes:

  ic_launcher / ic_launcher_round   icone legado, 48dp a 192dp, ja com os
                                    cantos arredondados que o proprio desenho
                                    faz.

  ic_launcher_foreground            camada da frente do icone adaptativo
                                    (108dp), de onde o launcher recorta a
                                    mascara que quiser. So os 72dp centrais
                                    sao zona segura, entao a arte entra
                                    reduzida nesse miolo. O fundo e a cor
                                    solida do app, declarada em
                                    values/ic_launcher_background.xml.

Uso:  python3 nativo/scripts/gerar-icones-android.py
"""
import importlib.util
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent

# Carregado pelo caminho porque o arquivo tem hifen no nome: nao da para
# importar por nome, e renomear quebraria quem ja usa o gerador do PWA.
_origem = RAIZ / "copiloto" / "icons" / "gerar-icones.py"
_spec = importlib.util.spec_from_file_location("gerar_icones_pwa", _origem)
_pwa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pwa)
FUNDO, desenhar, escrever_png = _pwa.FUNDO, _pwa.desenhar, _pwa.escrever_png

RES = AQUI.parent / "android" / "app" / "src" / "main" / "res"

# dp por densidade: mdpi=1x, hdpi=1.5x, xhdpi=2x, xxhdpi=3x, xxxhdpi=4x
DENSIDADES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

LEGADO_DP = 48
ADAPTATIVO_DP = 108
ZONA_SEGURA_DP = 72


def centralizar(arte, lado_arte, lado_final):
    """Cola a arte no meio de um quadrado transparente maior."""
    saida = bytearray(lado_final * lado_final * 4)
    desloc = (lado_final - lado_arte) // 2
    for y in range(lado_arte):
        origem = y * lado_arte * 4
        destino = ((y + desloc) * lado_final + desloc) * 4
        saida[destino:destino + lado_arte * 4] = arte[origem:origem + lado_arte * 4]
    return saida


def main():
    for densidade, escala in DENSIDADES.items():
        pasta = RES / f"mipmap-{densidade}"
        pasta.mkdir(parents=True, exist_ok=True)

        # legado: o desenho com cantos arredondados preenche o quadrado todo
        legado = int(LEGADO_DP * escala)
        arte = desenhar(legado, False)
        for nome in ("ic_launcher.png", "ic_launcher_round.png"):
            escrever_png(pasta / nome, legado, legado, arte)

        # adaptativo: arte da zona segura centrada num quadrado transparente
        lado = int(ADAPTATIVO_DP * escala)
        miolo = int(ZONA_SEGURA_DP * escala)
        frente = centralizar(desenhar(miolo, True), miolo, lado)
        escrever_png(pasta / "ic_launcher_foreground.png", lado, lado, frente)

        print(f"mipmap-{densidade}: legado {legado}px, adaptativo {lado}px")

    cor = "#%02X%02X%02X" % FUNDO
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{cor}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    print(f"fundo do icone adaptativo: {cor}")


if __name__ == "__main__":
    main()
