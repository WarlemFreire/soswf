#!/usr/bin/env python3
"""
Teste do miolo do macro: detectar a parte repetida entre dois prints e colar
tudo de volta numa tira unica. Roda sem tela, com prints falsos.

    python test_macro.py
"""

import random
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from macro_uber import achar_sobreposicao, diferenca, juntar_imagens, miniatura_cinza

LARGURA = 900
ALTURA_PAGINA = 4000
ALTURA_TELA = 700


def pagina_falsa():
    """Uma lista de corridas de mentira: linhas com blocos de texto."""
    random.seed(7)
    img = Image.new("RGB", (LARGURA, ALTURA_PAGINA), "white")
    d = ImageDraw.Draw(img)
    y = 20
    while y < ALTURA_PAGINA - 40:
        d.rectangle([40, y, LARGURA - 40, y + 90], outline=(220, 220, 220))
        d.text((60, y + 20), f"Corrida {y} - R$ {random.randint(8, 90)},00", fill="black")
        d.rectangle(
            [60, y + 50, 60 + random.randint(100, 500), y + 62],
            fill=(random.randint(0, 120),) * 3,
        )
        y += 110
    return img


def prints_da_rolagem(pagina, passo, pasta):
    caminhos = []
    topo = 0
    n = 0
    while True:
        fim = min(topo + ALTURA_TELA, pagina.height)
        recorte = pagina.crop((0, fim - ALTURA_TELA, LARGURA, fim))
        n += 1
        caminho = pasta / f"print-{n:03d}.png"
        recorte.save(caminho)
        caminhos.append(caminho)
        if fim >= pagina.height:
            break
        topo += passo
    return caminhos


def checar(condicao, descricao):
    print(("  ok   " if condicao else "  FALHA") + f" {descricao}")
    return condicao


def main():
    pagina = pagina_falsa()
    tudo_certo = True

    with tempfile.TemporaryDirectory() as tmp:
        pasta = Path(tmp)

        print("telas iguais x telas diferentes")
        a = pagina.crop((0, 0, LARGURA, ALTURA_TELA))
        b = pagina.crop((0, 300, LARGURA, 300 + ALTURA_TELA))
        tudo_certo &= checar(
            diferenca(miniatura_cinza(a), miniatura_cinza(a)) == 0.0,
            "print identico da diferenca zero (e o que detecta o fim da lista)",
        )
        tudo_certo &= checar(
            diferenca(miniatura_cinza(a), miniatura_cinza(b)) > 1.0,
            "print rolado da diferenca acima da tolerancia",
        )

        print("\ndeteccao da parte repetida")
        for passo in (200, 400, 650):
            a = pagina.crop((0, 0, LARGURA, ALTURA_TELA))
            b = pagina.crop((0, passo, LARGURA, passo + ALTURA_TELA))
            esperado = ALTURA_TELA - passo
            achado = achar_sobreposicao(a, b)
            tudo_certo &= checar(
                abs(achado - esperado) <= 12,
                f"rolagem de {passo}px: repetido {achado}px (esperado ~{esperado}px)",
            )

        print("\nmontagem da tira unica")
        for passo in (250, 500):
            sub = pasta / f"passo{passo}"
            sub.mkdir()
            caminhos = prints_da_rolagem(pagina, passo, sub)
            gerados = juntar_imagens(caminhos, sub / "completo.png")
            tudo_certo &= checar(len(gerados) == 1, f"passo {passo}: uma imagem so")
            final = Image.open(gerados[0])
            folga = abs(final.height - pagina.height)
            tudo_certo &= checar(
                folga <= 40,
                f"passo {passo}: {len(caminhos)} prints viraram "
                f"{final.height}px (pagina tem {pagina.height}px)",
            )

        print("\nprint repetido no fim (lista acabou) nao duplica conteudo")
        sub = pasta / "repetido"
        sub.mkdir()
        caminhos = prints_da_rolagem(pagina, 500, sub)
        ultimo = Image.open(caminhos[-1])
        extra = sub / "print-999.png"
        ultimo.save(extra)
        gerados = juntar_imagens(caminhos + [extra], sub / "completo.png")
        altura = Image.open(gerados[0]).height
        tudo_certo &= checar(
            abs(altura - pagina.height) <= 40,
            f"tira ficou com {altura}px mesmo com print repetido no fim",
        )

        print("\ncabecalho fixo do site descartado com --corte-topo")
        sub = pasta / "cabecalho"
        sub.mkdir()
        caminhos = prints_da_rolagem(pagina, 500, sub)
        cabecalho = Image.new("RGB", (LARGURA, 120), (30, 30, 30))
        ImageDraw.Draw(cabecalho).text((40, 50), "Uber - Suas viagens", fill="white")
        for caminho in caminhos:
            print_com_cabecalho = Image.open(caminho)
            print_com_cabecalho.paste(cabecalho, (0, 0))
            print_com_cabecalho.save(caminho)
        sem_corte = Image.open(
            juntar_imagens(caminhos, sub / "sem-corte.png")[0]
        ).height
        com_corte = Image.open(
            juntar_imagens(caminhos, sub / "com-corte.png", corte_topo=120)[0]
        ).height
        tudo_certo &= checar(
            com_corte < sem_corte,
            f"com corte a tira fica menor: {com_corte}px contra {sem_corte}px",
        )
        tudo_certo &= checar(
            abs(com_corte - (pagina.height - 120)) <= 60,
            f"conteudo remontado em {com_corte}px (esperado ~{pagina.height - 120}px)",
        )

    print("\n" + ("TUDO CERTO" if tudo_certo else "TEM TESTE FALHANDO"))
    return 0 if tudo_certo else 1


if __name__ == "__main__":
    sys.exit(main())
