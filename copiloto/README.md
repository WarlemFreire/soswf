# Copiloto — Fase 1

Assistente de jornada para motorista de aplicativo. Roda no navegador, instala
como app (PWA), funciona 100% offline e não manda dado nenhum para lugar nenhum.

**Endereço:** `/copiloto/` no mesmo site. Sem link no menu — só quem sabe o
endereço chega.

## O que a Fase 1 faz

- Abrir e fechar jornada (odômetro do painel só duas vezes por dia)
- Checkpoint parcial de saldo: Uber, 99, inDrive e avulsos (frete/particular)
- R$/hora e R$/km ao vivo, com semáforo por período do dia
- Linha de break-even no medidor de R$/km
- Barra de meta tripla (mínima / ideal / ótima) e projeção de horário
- Pausas com motivo, descontadas automaticamente do tempo ativo
- Medição de km por GPS, ancorada no odômetro
- Modo noturno automático, modo dirigindo, wake lock, vibração e leitura em voz alta
- Desfazer de 8 segundos em todo registro — o app nunca pergunta "tem certeza?"
- Backup em JSON e exportação em CSV (dias, registros e pausas)

Fases seguintes: abastecimento com consumo real (2), alertas e contexto (3),
dashboards de análise (4).

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
- **O líquido é estimado**, calculado pelo custo por km configurado. A Fase 2
  troca a estimativa pelo consumo real medido entre abastecimentos.
