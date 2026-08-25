# Copiloto

Assistente de jornada para motorista de aplicativo. Roda no navegador, instala
como app (PWA), funciona 100% offline e não manda dado nenhum para lugar nenhum.

**Endereço:** `/copiloto/` no mesmo site. Sem link no menu — só quem sabe o
endereço chega.

## O que o app faz

- Abrir e fechar jornada (odômetro do painel só duas vezes por dia)
- Checkpoint parcial de saldo: Uber, 99, inDrive e avulsos (frete/particular)
- R$/hora e R$/km ao vivo, com semáforo por período do dia
- Linha de break-even no medidor de R$/km
- Barra de meta tripla (mínima / ideal / ótima) e projeção de horário
- Pausas com motivo, descontadas automaticamente do tempo ativo
- Medição de km por GPS, ancorada no odômetro
- Modo noturno automático, modo dirigindo, wake lock, vibração e leitura em voz alta
- Desfazer de 8 segundos em todo registro — o app nunca pergunta "tem certeza?"
- Registro granular de corrida, com cronômetro por GPS que mede km, duração,
  deslocamento até o passageiro e espera desde a corrida anterior
- Saída no formato exato da planilha de histórico (ver abaixo)
- Backup em JSON e exportação em CSV (dias, registros, pausas e corridas)

Fases seguintes: abastecimento com consumo real, alertas determinísticos,
contexto (clima/trânsito) e os dashboards de análise.

## A planilha

O app alimenta a planilha `Historico_Corridas_Uber1.xlsx` sem substituí-la.

**Copiar as corridas** (no fechamento do dia ou em Ajustes) põe na área de
transferência linhas tabuladas nas colunas **A–I da aba Corridas**:

```
Data · Hora · Plataforma · Valor · Dinâmico · KM · Tempo (min) · Origem · Destino
```

Cola-se na primeira linha vazia, na coluna Data. As colunas J–M já têm fórmula
até a linha 1000 e se recalculam sozinhas, assim como o Resumo Diário e o
Dashboard — por isso a exportação para em Destino, para não sobrescrever nada.
O separador decimal é configurável (vírgula por padrão), com prévia da linha
antes de copiar: número colado como texto zera as fórmulas sem avisar.

**As Horas Ativas** do Resumo Diário aparecem no fechamento com um botão de
copiar — o app mede esse número descontando as pausas, coisa que a planilha
não tem como saber.

O caminho é copiar/colar em vez de baixar arquivo porque baixar um CSV e
importar no Sheets pelo celular é sofrido; colar tabulado divide as colunas
sozinho e deixa a planilha interpretar os números no idioma dela.

### O que o app registra e a planilha não tem

| campo | por quê |
|---|---|
| KM de deslocamento | quanto rodou só para buscar o passageiro |
| R$/km real | valor ÷ (km da corrida + deslocamento) — responde de verdade se compensou |
| Espera (min) | tempo ocioso desde a corrida anterior |
| Custo e líquido por corrida | usando o custo por km calibrado |
| Coordenada de origem | análise por zona sem digitar bairro |

Sai tudo em **CSV completo das corridas**, nos Ajustes.

### Checkpoints e corridas juntos

As duas coisas convivem, mas nunca somam: quando existem checkpoints de saldo,
eles mandam — vêm do total da própria plataforma. As corridas só respondem pelo
bruto do dia quando não há checkpoint nenhum (caso do histórico importado).
Quando os dois existem, o app compara e avisa se faltou lançar corrida.

## Os números que o app usa

Calibrados sobre a operação real do motorista — 10h de rua, 200 km, R$ 350
brutos num dia típico — e todos editáveis em Ajustes.

| | valor |
|---|---|
| Metas do dia (bruto) | 280 / 350 / 450 |
| Faixa de R$/hora | piso 32 · ideal 40 · ótimo 50 |
| Energia | GNV R$ 4,30/m³ a 10 km/m³ (95% do rodado) |
| Desgaste | R$ 0,25/km |
| Break-even | **R$ 0,69/km** |

As faixas de R$/km por período são do **rendimento da jornada** (contando km
vazio), não da corrida ofertada — são coisas diferentes, e as tabelas genéricas
de mercado (1,80 a 7,00 R$/km) descrevem a segunda. Aplicadas à primeira,
deixariam o semáforo vermelho o dia inteiro.

| Período | piso | ideal | ótimo |
|---|---|---|---|
| Manhã 06–12 | 1,45 | 1,70 | 2,00 |
| Tarde 12–18 | 1,55 | 1,80 | 2,15 |
| Noite 18–22 | 1,70 | 2,00 | 2,40 |
| Pico 22–02 | 1,90 | 2,30 | 2,80 |
| Madrugada 02–06 | 1,70 | 2,00 | 2,40 |

## Checkpoint parcial

Ler o saldo de três apps a cada checkpoint levaria mais de um minuto — inviável
dirigindo. Em vez disso, cada plataforma guarda seu próprio último valor
conhecido com o próprio horário, e o motorista atualiza só a que mexeu:

```
Uber .......... R$ 187,40   14:32   ← acabou de atualizar
99 ............ R$  42,00   11:05   ← valor antigo, ainda válido
inDrive ....... R$   0,00     —
avulso ........ R$  80,00   13:10   ← incremento, não saldo
                ─────────
SALDO DO DIA .. R$ 309,40
```

Avulsos somam; saldos de plataforma substituem. Quando o total cai (estorno,
cancelamento, ou valor digitado no chip errado), o app pergunta — é a única
confirmação do app inteiro.

## Estrutura

```
copiloto/
  index.html            casca do app e navegação
  sw.js                 service worker (cache-first de tudo)
  manifest.webmanifest
  css/copiloto.css
  js/
    metrics.js          o cérebro: puro, determinístico, sem DOM
    config.js           faixas, metas e custos
    db.js               IndexedDB sem dependências
    store.js            estado da jornada e ações
    geo.js              km por GPS e wake lock
    keypad.js           teclado numérico próprio
    feedback.js         vibração, voz e o toast com desfazer
    export.js           backup JSON e CSV
    ui.js               helpers de DOM e folhas deslizantes
    tela-*.js           as telas
  icons/gerar-icones.py gera os PNGs do PWA (sem dependências)
  test/
    metrics.test.mjs    testes do cérebro
    check.sh            checagem de sintaxe dos módulos
```

Sem framework, sem build step, sem CDN — o mesmo padrão do resto do repositório,
e um requisito de verdade: um app que precisa funcionar sem rede não pode
depender de nada carregado de fora.

## Rodando os testes

```sh
node copiloto/test/metrics.test.mjs   # cálculos
copiloto/test/check.sh                # sintaxe dos módulos
```

## Limites conhecidos

- **Os dados vivem só neste aparelho.** Exporte um backup de tempos em tempos —
  se o celular sumir, o histórico vai junto.
- **R$/km é sempre agregado.** O odômetro é um só; não há como separar quantos
  km foram de Uber e quantos foram de 99.
- **GPS em segundo plano.** Com a tela apagada o navegador suspende a
  amostragem. O wake lock cobre a jornada ativa; fora disso o km avança quando
  um odômetro é informado.
- **O líquido é estimado**, calculado pelo custo por km configurado. A fase
  seguinte troca a estimativa pelo consumo real medido entre abastecimentos.
- **Dias importados da planilha não têm odômetro nem horas trabalhadas.** Eles
  ficam de fora das médias de R$/km, e só entram na média de R$/hora quando a
  coluna Horas Ativas estava preenchida. É de propósito: o intervalo entre a
  primeira e a última corrida do dia não é jornada trabalhada, e usar isso como
  denominador inventaria um número.
