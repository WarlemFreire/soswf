#!/usr/bin/env python3
"""Gera os icones PNG do extrator sem dependencia externa (so zlib + struct).

O desenho: a folha da planilha com as linhas de dado e a seta que puxa pra
fora - que é exatamente o que o app faz com os prints.

Uso:  python3 extrator-corridas/icons/gerar-icones.py
"""
import struct
import zlib
from pathlib import Path

FUNDO = (0x0B, 0x0F, 0x14)
FOLHA = (0xF2, 0xF6, 0xFB)
LINHA = (0x2F, 0x7D, 0xE0)
SETA = (0x56, 0xE0, 0x8C)
SUPER = 4  # supersampling para suavizar as bordas


def escrever_png(caminho, largura, altura, pixels):
    """pixels: bytearray RGBA de largura*altura*4."""
    linhas = bytearray()
    for y in range(altura):
        linhas.append(0)  # filtro "none"
        inicio = y * largura * 4
        linhas += pixels[inicio:inicio + largura * 4]

    def bloco(tipo, dados):
        return (
            struct.pack(">I", len(dados))
            + tipo
            + dados
            + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)
        )

    cabecalho = struct.pack(">IIBBBBB", largura, altura, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", cabecalho)
        + bloco(b"IDAT", zlib.compress(bytes(linhas), 9))
        + bloco(b"IEND", b"")
    )
    Path(caminho).write_bytes(png)


def dentro_arredondado(x, y, x0, y0, x1, y1, raio):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    for cx, cy in ((x0 + raio, y0 + raio), (x1 - raio, y0 + raio),
                   (x0 + raio, y1 - raio), (x1 - raio, y1 - raio)):
        if abs(x - cx) > raio or abs(y - cy) > raio:
            continue
        if ((x - cx) ** 2 + (y - cy) ** 2) > raio ** 2:
            if (x < x0 + raio or x > x1 - raio) and (y < y0 + raio or y > y1 - raio):
                return False
    return True


def na_seta(u, v, folga=0.0):
    """Seta pra baixo: haste + ponta. `folga` engorda ela pra abrir o vao."""
    if 0.63 - folga <= u <= 0.77 + folga and 0.46 - folga <= v <= 0.76:
        return True
    topo, base = 0.76, 0.93 + folga
    if 0.50 - folga <= u <= 0.90 + folga and topo <= v <= base:
        meio = 0.70
        largura = (0.20 + folga) * (1 - (v - topo) / (base - topo))
        return abs(u - meio) <= largura
    return False


def cor_do_ponto(u, v, margem):
    """u, v vao de 0 a 1. `margem` guarda a zona segura do icone mascarado."""
    e = margem
    if na_seta(u, v):
        return SETA
    if na_seta(u, v, folga=0.035):
        return FUNDO  # vao escuro entre a seta e a folha

    if dentro_arredondado(u, v, 0.13 + e, 0.10 + e, 0.72 - e / 2, 0.80 - e / 2, 0.06):
        for topo in (0.26, 0.40, 0.54):
            largura = 0.42 if topo != 0.54 else 0.26
            if 0.21 + e <= u <= 0.21 + e + largura * (1 - 2 * e) and topo + e <= v <= topo + 0.06 + e:
                return LINHA
        return FOLHA
    return None


def gerar(caminho, lado, margem=0.0, fundo=FUNDO):
    pixels = bytearray()
    for y in range(lado):
        for x in range(lado):
            soma = [0, 0, 0]
            for sy in range(SUPER):
                for sx in range(SUPER):
                    u = (x + (sx + 0.5) / SUPER) / lado
                    v = (y + (sy + 0.5) / SUPER) / lado
                    cor = cor_do_ponto(u, v, margem) or fundo
                    for i in range(3):
                        soma[i] += cor[i]
            total = SUPER * SUPER
            pixels += bytes((soma[0] // total, soma[1] // total, soma[2] // total, 255))
    escrever_png(caminho, lado, lado, pixels)
    print(f"{caminho} ({lado}x{lado})")


if __name__ == "__main__":
    aqui = Path(__file__).parent
    gerar(aqui / "icone-192.png", 192)
    gerar(aqui / "icone-512.png", 512)
    # Mascarado: o Android corta as bordas, entao tudo encolhe pro meio.
    gerar(aqui / "icone-mascara-512.png", 512, margem=0.08)
