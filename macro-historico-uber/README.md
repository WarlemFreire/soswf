# Macro de print do histórico de corridas

Tira print da tela, rola a página, tira outro print, e repete até chegar no fim
do histórico. No final ele junta tudo numa imagem só (sem repetir o pedaço que
aparece em dois prints seguidos) e, se você quiser, gera um PDF.

Serve pro histórico do Uber (`riders.uber.com/trips` ou o app de motorista no
navegador) e pra qualquer outra página comprida: iFood, 99, extrato de banco.

## Instalar

Precisa de Python 3.8 ou mais novo.

```bash
cd macro-historico-uber
pip install -r requirements.txt
```

No Linux o `pyautogui` ainda precisa de `sudo apt install python3-tk scrot` e de
sessão X11 (no Wayland ele não rola a página). No macOS, dê permissão de
**Gravação de Tela** e de **Acessibilidade** pro Terminal em Ajustes do Sistema
→ Privacidade e Segurança, senão o print sai preto e a rolagem não funciona.

## Usar

1. Abra o histórico de corridas no navegador e faça login.
2. Deixe a página no começo da lista (rolagem lá em cima).
3. Rode o macro e volte pro navegador antes da contagem acabar:

```bash
python macro_uber.py --juntar
```

4. Não mexa no mouse nem no teclado enquanto ele trabalha. Cada print sai numa
   pasta com data e hora dentro de `prints-uber/`.

Dica: dê um `Ctrl -` no navegador antes de começar. Com a página menor cabe mais
corrida por print e o macro termina mais rápido.

### Só a parte da lista, sem o resto da tela

```bash
python macro_uber.py --marcar-regiao --juntar
```

Ele pede pra você apontar o mouse no canto de cima à esquerda e no canto de
baixo à direita da lista, e mostra a medida pra você reaproveitar depois:

```bash
python macro_uber.py --regiao 300,180,900,760 --juntar --pdf
```

### Parar no meio

Jogue o mouse no canto superior esquerdo da tela, ou aperte `Ctrl+C` no
terminal. Os prints já tirados continuam salvos e ainda são juntados.

### Juntar prints que você já tem

```bash
python macro_uber.py --apenas-juntar prints-uber/2026-08-29_10-15-00 --pdf
```

## Como ele sabe que acabou

Depois de cada rolagem ele compara a tela nova com a anterior. Se ficou igual,
espera um pouco (o histórico do Uber carrega mais corridas conforme você desce) e
tenta de novo. Três telas iguais seguidas quer dizer fim da lista. Tem também um
teto de 300 prints pra ele nunca rodar sem parar.

Pra juntar os prints ele procura, em cada par, qual pedaço do topo do print novo
repete o rodapé do print anterior, e corta esse pedaço. Por isso não importa se a
rolagem do seu mouse anda 3 ou 10 linhas: ele se vira com qualquer passo, desde
que dois prints seguidos tenham alguma parte em comum.

## Opções

| Opção | Pra que serve |
| --- | --- |
| `--regiao x,y,l,a` | Área do print. Sem isso ele pega a tela inteira. |
| `--marcar-regiao` | Marca a área apontando o mouse nos dois cantos. |
| `--monitor N` / `--listar-monitores` | Escolhe o monitor em quem tem mais de um. |
| `--cliques N` | Quanto rola por vez (padrão 8). Diminua se sua tela for pequena. |
| `--modo pagedown` | Rola com a tecla Page Down em vez da roda do mouse. |
| `--espera S` | Segundos de espera depois de rolar (padrão 1,0). Internet lenta pede mais. |
| `--espera-inicial S` | Tempo pra você voltar pro navegador (padrão 5). |
| `--tentativas-fim N` | Quantas telas iguais contam como fim (padrão 3). |
| `--max-prints N` | Teto de prints (padrão 300). |
| `--juntar` | Cola tudo numa imagem só. |
| `--pdf` | Gera um PDF, uma página por print. |
| `--corte-topo N` / `--corte-base N` | Descarta cabeçalho/rodapé fixo do site na hora de juntar. |
| `--saida PASTA` | Onde gravar (padrão `prints-uber/`). |

Se o site tem um cabeçalho que fica grudado no topo enquanto você rola, meça a
altura dele em pixels e passe em `--corte-topo`. Sem isso o cabeçalho repetido
aparece no meio da imagem final e atrapalha a junção.

## Problemas comuns

- **Ele para no primeiro print.** A página não está rolando: clique uma vez na
  lista (num espaço vazio) antes de rodar, ou use `--modo pagedown`.
- **A imagem final ficou com pedaços repetidos.** Aumente `--espera` (o print
  saiu no meio da animação de rolagem) ou diminua `--cliques`.
- **A imagem final ficou com o cabeçalho no meio.** Use `--corte-topo`.
- **Print preto no macOS.** Falta a permissão de Gravação de Tela.

## Teste

```bash
python test_macro.py
```

Monta uma página de mentira com cara de lista de corridas, simula a rolagem e
confere se a detecção de fim de lista e a junção dos prints estão certas. Não
precisa de tela, roda em qualquer lugar.
