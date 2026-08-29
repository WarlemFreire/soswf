# Extrator de corridas

O celular tira os prints e rola a tela **sozinho**; esta página vira planilha.
Você toca duas vezes no começo e uma vez no fim. Nada é enviado pra lugar
nenhum: a leitura acontece dentro do seu aparelho.

Feito em cima da tela **Ganhos → Histórico de ganhos** do app de motorista.

---

## O caminho sem trabalho (Android)

A parte de rolar e printar é de um app de macro — ele já tem a permissão de
mexer na tela, que nenhuma página de navegador tem. O melhor grátis é o
**MacroDroid** (Play Store).

### 1. Prepare o MacroDroid

Instale, abra, e ligue as permissões que ele pedir — em especial
**Acessibilidade** (Ajustes → Acessibilidade → MacroDroid → ativar). É ela que
deixa o macro rolar a tela e ler o conteúdo.

### 2. Monte a macro (uma vez só, uns 10 minutos)

Adicionar macro → dê o nome de **Histórico Uber**.

**Gatilho:** `Agitar o aparelho` (ou `Botão de notificação`, se preferir tocar
num botão em vez de sacudir).

**Ações**, nesta ordem:

| # | Ação | Configuração |
| --- | --- | --- |
| 1 | `Loop` / `Repetir ações` | 40 vezes (dá conta de umas 4 semanas; aumente se precisar) |
| 2 | `Read Screen Contents` / `Ler conteúdo da tela` | salvar num dicionário chamado `tela` |
| 3 | `Write to File` / `Gravar em arquivo` | pasta `Download`, arquivo `uber.txt`, conteúdo `{lv=tela}`, marcar **Append** (anexar) |
| 4 | `Take Screenshot` / `Tirar captura de tela` | opcional, é o plano B se a leitura de texto falhar |
| 5 | `Swipe` / `Deslizar` para **cima** | é isso que rola a lista pra baixo |
| 6 | `Aguardar` | 2 segundos (internet lenta pede mais) |
| 7 | fim do Loop | |
| 8 | `Notificação` | "acabou" — pra você saber que pode pegar o celular |

A ação 2 é a que faz a diferença: ela lê o **texto** da tela pela
acessibilidade, não a imagem. Não erra número, não erra hora, não erra
endereço. O OCR só entra se essa ação não existir na sua versão.

### 3. Rode

1. Abra o app de motorista em **Ganhos → Histórico de ganhos**.
2. Escolha o período no filtro de cima (`24/08 – 30/08`, por exemplo).
3. Agite o celular e **largue o aparelho**. Ele vai rolando e gravando.
4. Quando chegar a notificação, acabou.

### 4. Jogue aqui dentro

Abra esta página no celular e instale ela (menu do Chrome → **Instalar app**).
Depois:

- **do arquivo de texto:** Arquivos → `Download/uber.txt` → Compartilhar →
  **Extrator**. Pronto, a planilha aparece.
- **dos prints:** Galeria → selecionar todos → Compartilhar → **Extrator**.
  Ele lê um por um com OCR e junta.

Nos dois casos ele começa a trabalhar sozinho assim que recebe. No fim, botão
**Baixar CSV** (abre no Excel e no Google Planilhas) ou **Baixar JSON**.

---

## O que ele extrai

Uma linha por corrida, com o que a tela mostrar:

`data`, `hora`, `tipo` (Uber X, Comfort…), `valor`, `dinâmico`, `status`
(“Você cancelou”, “Cancelado pelo usuário”), `km`, `duração`,
`bairro de origem`, `bairro de destino`, endereço completo dos dois lados,
`cidade`, `uf` — mais o `texto lido`, pra você conferir de onde saiu cada dado.

No fim ele soma tudo por dia e mostra quantas foram canceladas.

Três cuidados que ele toma sozinho:

- **Print rolado repete corrida.** A última corrida de um print é a primeira do
  seguinte. Ele junta as duas numa só — e fica com a versão mais completa,
  porque num print a corrida aparece cortada, sem endereço, e no outro inteira.
- **Total não é corrida.** Linha de “Ganhos da semana” ou “Total do dia” fica de
  fora, senão o dia dobra de valor.
- **Bairro que o OCR errou.** “Ipanema” lido como “Ibanema” uma vez, e certo em
  trinta outras, volta a ser Ipanema.

## Sobre o OCR (o plano B)

Testado num print de verdade da sua tela: valor, tipo, status, endereço e
bairro saem certos. O que ele mais erra é **a hora** — chegou a ler `0:32` como
`0:39` quando eu tentei "melhorar" a imagem antes. Por isso a página não mexe
mais na imagem, e por isso o caminho do texto (ação 2 da macro) é melhor.

A distância vem com um cuidado extra: o OCR come o ponto de `2.94 km` e entrega
`294 km`. Como o app sempre escreve a distância com casa decimal, número
inteiro de três dígitos volta a ter o ponto.

O motor de OCR (Tesseract) baixa uns 8 MB na primeira vez e depois fica no
aparelho. Se seu Chrome tiver o OCR nativo do Android ligado
(`chrome://flags` → *Experimental Web Platform features*), ele usa esse, que é
instantâneo.

## Se preferir sem macro nenhum

Dá pra tirar os prints na mão e compartilhar tudo de uma vez pra cá — o
resultado é o mesmo, só o trabalho é seu. E tem o campo de **colar texto**, que
serve pro “copiar texto” do Google Fotos.

## Rodar sem internet

Baixe o `tesseract.min.js`, o `worker.min.js`, os arquivos do
`tesseract.js-core` e o `por.traineddata.gz`, ponha numa pasta `vendor/` ao lado
da página e declare antes do script do app:

```html
<script>window.EXTRATOR_OCR = {
  script: "vendor/tesseract.min.js", workerPath: "vendor/worker.min.js",
  corePath: "vendor/", langPath: "vendor/lang"
};</script>
```

## Teste

```bash
node extrator-corridas/test/parser.test.mjs   # 29 testes
sh extrator-corridas/test/check.sh            # sintaxe dos módulos
```

O arquivo `test/ocr-real.txt` é a saída crua do OCR em cima de um print de
verdade, com toda a sujeira: ícone que virou `?`, nome de restaurante que o
mapa mostrava, barra de status. Se um dia o parser quebrar com ele, quebrou pro
motorista também.
