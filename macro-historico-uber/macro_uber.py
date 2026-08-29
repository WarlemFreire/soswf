#!/usr/bin/env python3
"""
Macro de print do historico de corridas (Uber).

Fluxo: abre o historico no navegador, o macro tira print da area escolhida,
rola a pagina, tira outro print, e repete ate o conteudo parar de mudar
(fim da lista). No final pode juntar tudo numa imagem unica (sem repetir a
parte que aparece nos dois prints) e/ou gerar um PDF.

Uso rapido:
    python macro_uber.py                      # tela cheia, escolhe o monitor 1
    python macro_uber.py --marcar-regiao      # marca a area com o mouse
    python macro_uber.py --regiao 300,180,900,760 --juntar --pdf

Parar no meio: jogue o mouse no canto superior esquerdo da tela (failsafe do
pyautogui) ou aperte Ctrl+C no terminal. Os prints ja tirados sao mantidos.
"""

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------- utilidades


def erro(msg):
    print(f"\n[erro] {msg}", file=sys.stderr)
    sys.exit(1)


def importar_pillow():
    try:
        from PIL import Image
    except ImportError:
        erro("falta a Pillow. Instale com: pip install -r requirements.txt")
    return Image


def importar_numpy():
    try:
        import numpy
    except ImportError:
        erro("falta o numpy. Instale com: pip install -r requirements.txt")
    return numpy


def importar_pyautogui():
    try:
        import pyautogui
    except Exception as exc:  # noqa: BLE001 - pyautogui explode de varios jeitos
        erro(
            "nao consegui carregar o pyautogui (%s).\n"
            "Instale com: pip install -r requirements.txt\n"
            "No Linux ele precisa de sessao grafica X11 e do pacote scrot/python3-tk."
            % exc
        )
    pyautogui.FAILSAFE = True  # mouse no canto superior esquerdo aborta
    return pyautogui


# ------------------------------------------------------------------ captura


class Camera:
    """Captura de tela via mss, com pyautogui como reserva."""

    def __init__(self, monitor=1):
        self.Image = importar_pillow()
        self.monitor = monitor
        self._mss = None
        try:
            import mss

            self._mss = mss.mss()
            self._monitores = self._mss.monitors
            if monitor >= len(self._monitores):
                erro(
                    f"monitor {monitor} nao existe. Monitores disponiveis: "
                    f"1..{len(self._monitores) - 1} (use --listar-monitores)"
                )
        except ImportError:
            self._mss = None

    def area_do_monitor(self):
        if self._mss:
            m = self._monitores[self.monitor]
            return (m["left"], m["top"], m["width"], m["height"])
        pyautogui = importar_pyautogui()
        largura, altura = pyautogui.size()
        return (0, 0, largura, altura)

    def tirar(self, regiao):
        x, y, largura, altura = regiao
        if self._mss:
            quadro = self._mss.grab(
                {"left": x, "top": y, "width": largura, "height": altura}
            )
            return self.Image.frombytes("RGB", quadro.size, quadro.bgra, "raw", "BGRX")
        pyautogui = importar_pyautogui()
        return pyautogui.screenshot(region=(x, y, largura, altura)).convert("RGB")


def listar_monitores():
    try:
        import mss
    except ImportError:
        erro("para listar monitores instale o mss: pip install -r requirements.txt")
    with mss.mss() as sct:
        for i, m in enumerate(sct.monitors):
            rotulo = "todos juntos" if i == 0 else f"monitor {i}"
            print(
                f"{i}: {rotulo} - {m['width']}x{m['height']} "
                f"em ({m['left']}, {m['top']})"
            )


# ------------------------------------------------------- comparacao de telas


def cinza(imagem, largura_alvo=None):
    """Array numpy em tons de cinza, opcionalmente reduzido de tamanho."""
    np = importar_numpy()
    if largura_alvo and imagem.width > largura_alvo:
        altura = max(1, round(imagem.height * largura_alvo / imagem.width))
        imagem = imagem.resize((largura_alvo, altura))
    return np.asarray(imagem.convert("L"), dtype="float32")


def miniatura_cinza(imagem, largura_alvo=320):
    """Versao pequena e em tons de cinza, boa para comparar telas rapidinho."""
    return cinza(imagem, largura_alvo)


def diferenca(a, b):
    """Diferenca media (0 a 255) entre duas telas ja convertidas."""
    np = importar_numpy()
    if a.shape != b.shape:
        return 255.0
    return float(np.abs(a - b).mean())


def _notas_por_deslocamento(a, b, minimo):
    np = importar_numpy()
    altura = min(a.shape[0], b.shape[0])
    return [
        (float(np.abs(a[a.shape[0] - d :] - b[:d]).mean()), d)
        for d in range(minimo, altura + 1)
    ]


def _candidatos(notas, quantos=8, distancia=3):
    """Melhores deslocamentos, sem repetir vizinhos quase iguais."""
    escolhidos = []
    for nota, desloc in sorted(notas):
        if any(abs(desloc - d) <= distancia for _, d in escolhidos):
            continue
        escolhidos.append((nota, desloc))
        if len(escolhidos) == quantos:
            break
    return escolhidos


def achar_sobreposicao(anterior, proxima, minimo_pct=0.03, tolerancia=6.0):
    """
    Quantos pixels do topo de `proxima` repetem o rodape de `anterior`.

    Primeiro procura nas miniaturas, que e rapido, e depois confere os
    melhores palpites na resolucao cheia - lista de corrida tem linha toda do
    mesmo tamanho, e na miniatura uma linha errada parece igual a certa.
    Devolve 0 quando nao acha repeticao confiavel.
    """
    a_mini, b_mini = miniatura_cinza(anterior), miniatura_cinza(proxima)
    if a_mini.shape[1] != b_mini.shape[1]:
        return 0
    minimo_mini = max(4, int(a_mini.shape[0] * minimo_pct))
    notas = _notas_por_deslocamento(a_mini, b_mini, minimo_mini)
    if not notas:
        return 0

    a_cheia, b_cheia = cinza(anterior), cinza(proxima)
    if a_cheia.shape[1] != b_cheia.shape[1]:
        return 0
    altura_cheia = min(a_cheia.shape[0], b_cheia.shape[0])
    minimo_cheio = max(4, int(a_cheia.shape[0] * minimo_pct))
    escala = proxima.height / b_mini.shape[0]
    janela = int(escala) + 2

    melhor = None
    vistos = set()
    for _, desloc in _candidatos(notas):
        centro = int(round(desloc * escala))
        for d in range(
            max(minimo_cheio, centro - janela), min(altura_cheia, centro + janela) + 1
        ):
            if d in vistos:
                continue
            vistos.add(d)
            nota = diferenca(a_cheia[a_cheia.shape[0] - d :], b_cheia[:d])
            if melhor is None or nota < melhor[0]:
                melhor = (nota, d)

    if melhor is None or melhor[0] > tolerancia:
        return 0
    return melhor[1]


# --------------------------------------------------------------- montagem


def recortar(imagem, topo, base):
    if topo <= 0 and base <= 0:
        return imagem
    altura = imagem.height
    y0 = min(max(0, topo), altura - 1)
    y1 = max(y0 + 1, altura - max(0, base))
    return imagem.crop((0, y0, imagem.width, y1))


def juntar_imagens(caminhos, destino, corte_topo=0, corte_base=0, altura_max=30000):
    """Cola os prints numa tira unica, removendo a parte repetida."""
    Image = importar_pillow()
    if not caminhos:
        erro("nao tem nenhuma imagem para juntar")

    fatias = []
    anterior = None
    for caminho in caminhos:
        atual = recortar(Image.open(caminho).convert("RGB"), corte_topo, corte_base)
        if anterior is None:
            fatias.append(atual)
        else:
            repetido = achar_sobreposicao(anterior, atual)
            if repetido >= atual.height:
                anterior = atual
                continue  # print inteiro repetido, nao acrescenta nada
            fatias.append(atual.crop((0, repetido, atual.width, atual.height)))
        anterior = atual

    largura = max(f.width for f in fatias)
    gerados = []
    parte = []
    altura_parte = 0

    def gravar(parte, indice):
        if not parte:
            return
        alvo = Image.new("RGB", (largura, sum(f.height for f in parte)), "white")
        y = 0
        for f in parte:
            alvo.paste(f, (0, y))
            y += f.height
        nome = destino if indice == 0 else destino.with_name(
            f"{destino.stem}-parte{indice + 1}{destino.suffix}"
        )
        alvo.save(nome)
        gerados.append(nome)

    for fatia in fatias:
        if altura_parte and altura_parte + fatia.height > altura_max:
            gravar(parte, len(gerados))
            parte, altura_parte = [], 0
        parte.append(fatia)
        altura_parte += fatia.height
    gravar(parte, len(gerados))
    return gerados


def gerar_pdf(caminhos, destino):
    Image = importar_pillow()
    paginas = [Image.open(c).convert("RGB") for c in caminhos]
    if not paginas:
        erro("nao tem nenhuma imagem para virar PDF")
    paginas[0].save(destino, save_all=True, append_images=paginas[1:])
    return destino


# ------------------------------------------------------------------- macro


def marcar_regiao():
    pyautogui = importar_pyautogui()
    print("\nVamos marcar a area do print (a lista de corridas).")
    cantos = []
    for nome in ("canto SUPERIOR ESQUERDO", "canto INFERIOR DIREITO"):
        input(f"  Leve o mouse ate o {nome} da area e aperte Enter...")
        ponto = pyautogui.position()
        cantos.append((ponto.x, ponto.y))
        print(f"    marcado em {ponto.x}, {ponto.y}")
    (x1, y1), (x2, y2) = cantos
    x, y = min(x1, x2), min(y1, y2)
    largura, altura = abs(x2 - x1), abs(y2 - y1)
    if largura < 50 or altura < 50:
        erro("a area marcada ficou pequena demais")
    print(f"  area: --regiao {x},{y},{largura},{altura}")
    return (x, y, largura, altura)


def contagem(segundos):
    if segundos <= 0:
        return
    print("\nAbra o historico do Uber e deixe a janela na frente. Comeco em:")
    for restante in range(segundos, 0, -1):
        print(f"  {restante}...", end="\r", flush=True)
        time.sleep(1)
    print("  valendo!    ")


def rolar(pyautogui, args, centro):
    pyautogui.moveTo(*centro)
    if args.modo == "pagedown":
        pyautogui.press("pagedown", presses=args.cliques, interval=0.05)
    else:
        pyautogui.scroll(-abs(args.cliques))


def capturar(args, pasta):
    pyautogui = importar_pyautogui()
    camera = Camera(args.monitor)

    if args.marcar_regiao:
        regiao = marcar_regiao()
    elif args.regiao:
        try:
            regiao = tuple(int(p) for p in args.regiao.split(","))
            if len(regiao) != 4:
                raise ValueError
        except ValueError:
            erro("--regiao precisa ser no formato x,y,largura,altura")
    else:
        regiao = camera.area_do_monitor()
        print(f"Usando a tela inteira: {regiao[2]}x{regiao[3]}")

    centro = (regiao[0] + regiao[2] // 2, regiao[1] + regiao[3] // 2)
    contagem(args.espera_inicial)

    caminhos = []
    anterior = None
    parados = 0
    numero = 0

    while numero < args.max_prints:
        imagem = camera.tirar(regiao)
        atual = miniatura_cinza(imagem)

        if anterior is not None and diferenca(anterior, atual) <= args.tolerancia:
            parados += 1
            print(
                f"  tela igual a anterior ({parados}/{args.tentativas_fim}) - "
                "esperando carregar ou fim da lista"
            )
            if parados >= args.tentativas_fim:
                print("\nChegou no fim do historico.")
                break
            time.sleep(args.espera_carregamento)
            rolar(pyautogui, args, centro)
            time.sleep(args.espera)
            continue

        parados = 0
        anterior = atual
        numero += 1
        caminho = pasta / f"print-{numero:03d}.png"
        imagem.save(caminho)
        caminhos.append(caminho)
        print(f"  print {numero:03d} salvo em {caminho.name}")

        rolar(pyautogui, args, centro)
        time.sleep(args.espera)
    else:
        print(f"\nParei no limite de {args.max_prints} prints (--max-prints).")

    return caminhos


def imagens_da_pasta(pasta):
    """Imagens da pasta, ignorando o que o proprio programa gerou antes."""
    tudo = sorted(
        p
        for p in pasta.iterdir()
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
        and not p.stem.startswith("historico-completo")
    )
    prints = [p for p in tudo if p.stem.startswith("print-")]
    return prints or tudo


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Tira print do historico de corridas rolando a pagina ate o fim.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--regiao", help="area do print: x,y,largura,altura")
    p.add_argument(
        "--marcar-regiao",
        action="store_true",
        help="marca a area apontando o mouse nos dois cantos",
    )
    p.add_argument("--monitor", type=int, default=1, help="monitor usado (padrao: 1)")
    p.add_argument("--listar-monitores", action="store_true", help="lista os monitores")
    p.add_argument(
        "--saida",
        default="prints-uber",
        help="pasta onde os prints sao gravados (padrao: prints-uber)",
    )
    p.add_argument(
        "--modo",
        choices=("rolagem", "pagedown"),
        default="rolagem",
        help="rola com a roda do mouse (padrao) ou com a tecla Page Down",
    )
    p.add_argument(
        "--cliques",
        type=int,
        default=8,
        help="quanto rola por vez: cliques da roda ou toques no Page Down (padrao: 8)",
    )
    p.add_argument(
        "--espera",
        type=float,
        default=1.0,
        help="segundos de espera depois de rolar (padrao: 1.0)",
    )
    p.add_argument(
        "--espera-carregamento",
        type=float,
        default=2.0,
        help="espera extra quando a tela nao muda, para dar tempo de carregar "
        "mais corridas (padrao: 2.0)",
    )
    p.add_argument(
        "--espera-inicial",
        type=int,
        default=5,
        help="segundos antes de comecar, para voce abrir o navegador (padrao: 5)",
    )
    p.add_argument(
        "--tentativas-fim",
        type=int,
        default=3,
        help="quantas telas iguais seguidas contam como fim da lista (padrao: 3)",
    )
    p.add_argument(
        "--tolerancia",
        type=float,
        default=1.0,
        help="quanto duas telas podem diferir e ainda serem consideradas iguais, "
        "de 0 a 255 (padrao: 1.0)",
    )
    p.add_argument(
        "--max-prints",
        type=int,
        default=300,
        help="limite de prints, para nao rodar sem fim (padrao: 300)",
    )
    p.add_argument("--juntar", action="store_true", help="cola tudo numa imagem so")
    p.add_argument("--pdf", action="store_true", help="gera um PDF com os prints")
    p.add_argument(
        "--corte-topo",
        type=int,
        default=0,
        help="pixels descartados do topo de cada print ao juntar (cabecalho fixo)",
    )
    p.add_argument(
        "--corte-base",
        type=int,
        default=0,
        help="pixels descartados da base de cada print ao juntar (rodape fixo)",
    )
    p.add_argument(
        "--apenas-juntar",
        metavar="PASTA",
        help="nao tira print nenhum: so junta/converte os prints que ja estao na pasta",
    )
    args = p.parse_args(argv)

    if args.listar_monitores:
        listar_monitores()
        return 0

    if args.apenas_juntar:
        pasta = Path(args.apenas_juntar)
        if not pasta.is_dir():
            erro(f"pasta nao encontrada: {pasta}")
        caminhos = imagens_da_pasta(pasta)
        if not caminhos:
            erro(f"nenhuma imagem em {pasta}")
        print(f"{len(caminhos)} imagens encontradas em {pasta}")
        if not args.juntar and not args.pdf:
            args.juntar = True
    else:
        pasta = Path(args.saida) / datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        pasta.mkdir(parents=True, exist_ok=True)
        print(f"Prints vao para: {pasta.resolve()}")
        try:
            caminhos = capturar(args, pasta)
        except KeyboardInterrupt:
            print("\nParado por voce (Ctrl+C).")
            caminhos = imagens_da_pasta(pasta)
        except Exception as exc:  # noqa: BLE001
            nome = type(exc).__name__
            if nome == "FailSafeException":
                print("\nParado pelo failsafe (mouse no canto da tela).")
                caminhos = imagens_da_pasta(pasta)
            else:
                raise
        print(f"\n{len(caminhos)} prints em {pasta.resolve()}")

    if args.juntar and caminhos:
        destino = pasta / "historico-completo.png"
        gerados = juntar_imagens(
            caminhos, destino, args.corte_topo, args.corte_base
        )
        for g in gerados:
            print(f"Imagem unica: {g.resolve()}")
    if args.pdf and caminhos:
        destino = gerar_pdf(caminhos, pasta / "historico-completo.pdf")
        print(f"PDF: {destino.resolve()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
