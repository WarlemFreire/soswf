#!/usr/bin/env python3
"""Gera os icones PNG do PWA sem dependencia externa (so zlib + struct).

O desenho é o proprio medidor semaforico do app: arco vermelho / amarelo /
verde / azul com a agulha na faixa verde.

Uso:  python3 copiloto/icons/gerar-icones.py
"""
import math
import struct
import zlib
from pathlib import Path

FUNDO = (0x0B, 0x0F, 0x14)
TINTA = (0xF2, 0xF6, 0xFB)
ZONAS = [
    (0.00, 0.26, (0xFF, 0x7B, 0x7B)),
    (0.26, 0.52, (0xFF, 0xD2, 0x4A)),
    (0.52, 0.80, (0x56, 0xE0, 0x8C)),
    (0.80, 1.01, (0x66, 0xD9, 0xFF)),
]
ANGULO_INICIO, ANGULO_FIM = 205.0, -25.0
POSICAO_AGULHA = 0.63
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

    png = b"\x89PNG\r\n\x1a\n"
    png += bloco(b"IHDR", struct.pack(">IIBBBBB", largura, altura, 8, 6, 0, 0, 0))
    png += bloco(b"IDAT", zlib.compress(bytes(linhas), 9))
    png += bloco(b"IEND", b"")
    Path(caminho).write_bytes(png)


def cor_da_zona(t):
    for inicio, fim, cor in ZONAS:
        if inicio <= t < fim:
            return cor
    return ZONAS[-1][2]


def desenhar(tamanho, sangria):
    """sangria=True preenche o quadrado inteiro (icone maskable)."""
    s = tamanho * SUPER
    cx, cy = s / 2, s * 0.565
    raio = s * (0.27 if sangria else 0.32)
    espessura = s * (0.085 if sangria else 0.10)
    raio_canto = s * 0.22

    pixels = bytearray(s * s * 4)
    for y in range(s):
        for x in range(s):
            px, py = x + 0.5, y + 0.5

            dentro_fundo = True
            if not sangria:
                # cantos arredondados
                dx = max(raio_canto - px, px - (s - raio_canto), 0)
                dy = max(raio_canto - py, py - (s - raio_canto), 0)
                dentro_fundo = math.hypot(dx, dy) <= raio_canto

            cor, alfa = FUNDO, (255 if dentro_fundo else 0)

            dist = math.hypot(px - cx, py - cy)
            if dentro_fundo and abs(dist - raio) <= espessura / 2:
                ang = math.degrees(math.atan2(cy - py, px - cx))
                if ang < ANGULO_FIM:
                    ang += 360
                if ANGULO_FIM <= ang <= ANGULO_INICIO:
                    t = (ANGULO_INICIO - ang) / (ANGULO_INICIO - ANGULO_FIM)
                    cor = cor_da_zona(t)

            # agulha
            if dentro_fundo:
                ang_agulha = math.radians(ANGULO_INICIO - POSICAO_AGULHA * (ANGULO_INICIO - ANGULO_FIM))
                ax, ay = math.cos(ang_agulha), -math.sin(ang_agulha)
                proj = (px - cx) * ax + (py - cy) * ay
                if 0 <= proj <= raio * 0.82:
                    perp = abs((px - cx) * -ay + (py - cy) * ax)
                    if perp <= s * 0.022 * (1 - 0.45 * proj / (raio * 0.82)):
                        cor = TINTA
                if dist <= s * 0.055:
                    cor = TINTA

            i = (y * s + x) * 4
            pixels[i:i + 4] = bytes((*cor, alfa))

    # downsample por media de blocos SUPER x SUPER
    saida = bytearray(tamanho * tamanho * 4)
    for y in range(tamanho):
        for x in range(tamanho):
            r = g = b = a = 0
            for dy in range(SUPER):
                base = ((y * SUPER + dy) * s + x * SUPER) * 4
                for dx in range(SUPER):
                    i = base + dx * 4
                    r += pixels[i]
                    g += pixels[i + 1]
                    b += pixels[i + 2]
                    a += pixels[i + 3]
            n = SUPER * SUPER
            j = (y * tamanho + x) * 4
            saida[j:j + 4] = bytes((r // n, g // n, b // n, a // n))
    return saida


if __name__ == "__main__":
    aqui = Path(__file__).parent
    for nome, tamanho, sangria in [
        ("icone-192.png", 192, False),
        ("icone-512.png", 512, False),
        ("icone-mascara-512.png", 512, True),
    ]:
        escrever_png(aqui / nome, tamanho, tamanho, desenhar(tamanho, sangria))
        print(f"gerado {nome}")
