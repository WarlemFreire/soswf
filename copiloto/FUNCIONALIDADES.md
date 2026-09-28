# Copiloto — tudo o que ele faz e por que faz assim

Documento de referência para reconstruir o Copiloto (v2, nativo ou não) sem
perder nada do que já está de pé. Não é um manual de uso: é a lista das
funcionalidades, das decisões de interface e das regras de cálculo, com o
motivo de cada uma. O motivo importa tanto quanto a função — várias dessas
regras nasceram de erro que apareceu na rua.

Estado de referência: PWA, `copiloto-v22`, 6 abas, 225 medalhas, 157 testes
automatizados, zero dependência externa, zero backend.

---

## 1. O que o Copiloto é

Substitui o assistente humano que acompanhava a jornada em tempo real. Ele
responde, a qualquer segundo do turno, a três perguntas:

1. **Quanto eu já fiz hoje?**
2. **Estou indo bem agora, ou esfriei?**
3. **Vale a pena aceitar esta corrida?**

Tudo o mais no app existe para alimentar essas três respostas ou para
revisá-las depois.

### 1.1 Restrições fundadoras (não negociáveis)

| Restrição | Por quê |
|---|---|
| **Zero LLM.** Cem por cento determinístico. | Precisa responder igual, offline, em 200 ms, com o celular no suporte. E precisa ser auditável: todo número tem uma conta que dá para conferir na mão. |
| **Operável dirigindo ou parado, no escuro, com uma mão.** | É a condição real de uso. Interface que exige duas mãos ou luz não é usada. |
| **Nenhuma interação acima de 3 segundos.** | O semáforo abre. |
| **Nenhum alvo de toque menor que 64×64 px.** | Carro em movimento, dedo impreciso. |
| **Offline-first.** | Túnel, subsolo, periferia sem sinal. O app nunca pode depender de rede para funcionar. |
| **Todo dado fica no aparelho.** | Não existe backend. Nada sai sozinho. |

---

## 2. UI/UX — as decisões que fazem ele funcionar ao volante

Esta é a parte mais fácil de perder numa reescrita, porque cada item parece
um detalhe. Não é: é o que separa um app usável de uma planilha bonita.

### 2.1 Entrada de dados

- **Teclado numérico próprio, nunca o do sistema.** Teclas gigantes,
  layout fixo, sem autocorretor, sem emoji, sem barra de sugestão roubando
  metade da tela. O teclado do sistema abre com atraso, muda de altura e
  empurra o layout — inutilizável em movimento.
- **Horário nunca é digitado.** É capturado por toque, com `Date.now()`,
  no instante do toque. Digitar hora é lento, dá erro e nunca é o horário
  real do fato. "Iniciar jornada" é um toque; o horário vem de graça.
- **Números grandes, campo único por vez.** Uma folha (sheet) = uma
  pergunta. Nunca um formulário com seis campos.
- **Chips em grade, não listas suspensas.** Motivo de pausa, plataforma,
  tipo de bloco: tudo é botão visível em grade. `<select>` exige mira fina
  e abre um overlay do sistema.
- **Valores monetários em centavos inteiros na entrada.** Sem ponto, sem
  vírgula, sem decidir onde fica o separador com o carro andando.

### 2.2 Desfazer em vez de confirmar

Nenhum diálogo "tem certeza?". Toda ação destrutiva ou de registro é
executada na hora e oferece **desfazer** por alguns segundos. Confirmação
custa dois toques em todas as vezes, inclusive nas certas; desfazer custa
zero toque nas certas e dois nas erradas.

### 2.3 Honestidade visual

- **Travessão em vez de número inventado.** Se falta o odômetro, o R$/km
  mostra `—` e o app mede só a hora. Nunca preencher com zero, nunca
  estimar sem dizer. Um número errado é pior que a ausência dele, porque
  ele é usado para decidir corrida.
- **Toda métrica diz de onde veio.** Na tela de análise, cada bloco
  declara a fonte ("corridas com valor conferido", "trechos com odômetro
  nas duas pontas"). Quando a amostra é pequena, ele diz que é pequena em
  vez de exibir uma média de três corridas como se fosse lei.
- **A conta do saldo aparece aberta.** Não é "R$ 148". É
  "102 ao abrir + 46 nesta jornada". Se o número estiver errado, dá para
  ver qual metade está errada.

### 2.4 Noite, contraste e modo dirigindo

- **Tema escuro automático.** Vira sozinho no horário configurado (18h por
  padrão), não pelo tema do sistema — o sistema pode estar em claro e a rua
  está escura.
- **Alto contraste sempre**, claro ou escuro. Nada de texto cinza sobre
  cinza.
- **Modo dirigindo:** esconde a topbar, reduz a tela ao essencial, aumenta
  o que sobrou. Um toque para entrar e sair.
- **Paleta validada para daltonismo.** As cores categóricas foram testadas
  par a par nos três tipos de CVD, em claro e em escuro. Descoberta
  prática: só subconjuntos de **4 cores** passam em todos os pares. Por isso
  a grade da semana usa duas tonalidades e a linha do dia identifica cada
  bloco por **ícone + nome**, não por cor. Cor é reforço, nunca a única
  informação.
- **Feedback redundante:** vibração e voz (TTS) opcionais, para confirmar
  registro sem precisar olhar.

### 2.5 Navegação

- **Botão voltar do Android funciona.** Cada folha e cada aba empilha um
  estado no histórico; voltar fecha a folha, não o app. Sem isso o app
  fecha no meio de um registro.
- **Seis abas fixas no rodapé**, sempre no alcance do polegar:
  📍 Agora · 📅 Histórico · ⏰ Rotina · 📊 Análise · 🏆 Troféus · ⚙️ Ajustes.
- **Topbar** com avatar/foto, nome e ofensiva — identidade e streak
  sempre visíveis, porque é o que dá vontade de abrir o app.
- **Tela ligada opcional** (wake lock) enquanto a jornada está aberta.

---

## 3. Modelo de dados

IndexedDB local, sete coleções:

| Coleção | Guarda |
|---|---|
| `jornadas` | Abertura/fechamento do turno, saldo inicial declarado, odômetro, metas. |
| `registros` | Checkpoints ao longo do turno (valor por plataforma, avulso, odômetro). |
| `pausas` | Início, fim e motivo de cada parada. |
| `custos` | Abastecimentos e outros gastos. |
| `corridas` | Corridas individuais, com valor, km, bairros. |
| `contextos` | Marcações de posição/contexto. |
| `config` | Ajustes, metas, faixas, rotina semanal. |

### 3.1 Fonte única de verdade para dinheiro

Regra central, e a que mais economizou bug: **o dinheiro nunca é somado de
vários lugares**. Existe uma linha do tempo única do dia (`eventosDoDia`) —
as declarações de abertura da jornada mais todos os registros, em ordem
cronológica — e uma dobra sobre ela (`saldoPorFonte`) com duas semânticas:

- **Plataforma (Uber, 99, inDrive): o valor SUBSTITUI.** O app do
  motorista mostra o acumulado do dia; registrar "Uber: 180" quer dizer
  "o acumulado da Uber agora é 180", não "+180".
- **Avulso (particular, frete): o valor ACUMULA.** Cada um é um evento
  novo.

Confundir as duas semânticas gera saldo dobrado ou saldo que anda para
trás. Toda tela lê o resultado dessa dobra; nenhuma tela soma por conta
própria.

### 3.2 Camada de cálculo pura

Todo o cálculo mora em módulos **puros** — sem DOM, sem banco, sem rede,
sem `Date.now()` implícito. É o que permite os 157 testes. As telas só
pintam o que a camada de cálculo devolve. Na v2, manter essa separação
vale mais do que qualquer escolha de framework.

---

## 4. As duas escalas de R$/km — a descoberta mais importante do projeto

Existem **duas** medidas de R$/km e elas não se comparam:

| Escala | Ordem de grandeza real | O que mede |
|---|---|---|
| **Corrida ofertada** | ~3,40 a 3,80 | Valor ÷ km da corrida que o app oferece. Não inclui km vazio. |
| **Jornada** | ~1,90 | Ganho do turno ÷ km rodado no turno. Inclui deslocamento vazio, ida pra praça, volta pra casa. |

Medido nos mesmos dados: jornada 1,91 · corrida 3,43. Quase o dobro.

**Consequência prática:** faixas de mercado ("aceite acima de R$1,80/km")
são de escala de corrida. Aplicadas à jornada, deixam o semáforo verde
sempre. Aplicadas ao contrário, fazem recusar tudo. Qualquer número de
R$/km exibido precisa dizer, na própria tela, de qual escala é.

Foi misturando as duas que o piso de aceite chegou a mandar recusar
praticamente toda corrida.

---

## 5. Tela Agora — o painel do turno

O que aparece, na ordem:

1. **Saldo do dia**, com a conta aberta ("102 ao abrir + 46 nesta jornada").
2. **Três tiles: R$/hora · R$/km · Ativo.** O número grande é o do
   **bloco** (janela deslizante de 2 h); embaixo, menor, o do **dia**. A
   razão: o dia é o ritmo, o bloco é o desempenho agora. Só o dia esconde
   que esfriou há uma hora.
3. **Medidor de R$/km** com quatro patamares: chão · piso · ideal · ótimo.
4. **Barra de metas** (três níveis, ex. 280 / 350 / 450).
5. **Projeção** do fechamento, com horário-alvo ajustável (inclusive `⁺¹`
   para virar o dia). Só projeta com tempo ativo mínimo — antes disso a
   projeção é ruído.
6. **Piso de aceite da faixa horária atual** (§6).
7. **Cartão do plano do dia**, vindo da Rotina (§10).
8. **Botões grandes: registrar · pausar.**

### 5.1 Janela deslizante de bloco

O bloco é a janela de 2 h (configurável) que termina agora. Ele é o
sinal de "esfriou" — R$/h do bloco caindo abaixo do R$/h do dia significa
que a região ou o horário virou, e é hora de mudar de praça.

---

## 6. Piso de aceite — e o erro que ele já causou

**O erro:** exibir a **mediana** das corridas e chamar aquilo de corte.
Por definição, metade das corridas fica abaixo da mediana. Seguir isso
significa recusar metade do dia. Além disso, comparava corrida com corrida,
quando a pergunta certa é se a corrida sustenta o **dia**.

**Como está hoje:** um único piso, **por hora**, derivado da faixa medida
do próprio histórico naquela faixa horária. R$/h é medível com honestidade
porque o tempo sempre existe; km só existe quando o odômetro foi anotado
nas duas pontas.

**O piso por km foi removido.** Ele dependia de aproveitamento de km, que
dependia de log completo de corridas, que na prática não existe. Piso
calculado sobre amostra incompleta manda recusar corrida boa. Melhor não
ter o número do que ter o número errado.

**Lição para a v2:** um piso de aceite só pode nascer de uma amostra que
você sabe que está completa. Sem isso, mostre a faixa observada (descrição)
e não um corte (prescrição).

### 6.1 Faixas medidas por faixa horária

Cinco faixas: manhã · tarde · noite · pico · madrugada. Para cada uma, o
app calcula do histórico os percentis de R$/km e R$/h e deriva
piso / ideal / ótimo. Regras de honestidade embutidas:

- Mínimo de amostra (8 trechos, 12 corridas) — abaixo disso devolve
  `null` e a tela mostra travessão.
- Piso nunca abaixo do chão de custo (break-even).
- km só entra quando **as duas pontas** têm odômetro real.
- Dados importados de planilha ficam fora do cálculo de trecho.

As faixas começam calibradas por semente e vão sendo **substituídas pelo
medido** conforme o histórico cresce. Semente é chute; medida é verdade.

---

## 7. Jornada, registros e odômetro

- **Várias jornadas por dia**, cada uma com saldo inicial declarado.
- **Checkpoint parcial por plataforma** a qualquer momento: dois toques e
  um número.
- **Avulso** com tipo (particular, frete).
- **Odômetro manual**, opcional, na abertura e no fechamento, e em
  qualquer registro.
- **Correção de jornada já encerrada**, inclusive do saldo.
- **Fechamento** com resumo do turno.

### 7.1 Filtro de plausibilidade do odômetro (bug real)

O km chegou a aparecer como o odômetro inteiro do carro — 180 mil km
rodados num turno. Três causas somadas: campo em branco virava `0` porque
`Number("")` é `0`; o cálculo só protegia contra `null`; e o zero entrava
como primeira âncora. Correção em três camadas, todas necessárias:

1. **Na entrada:** branco/inválido vira `null`, nunca `0`.
2. **No cálculo:** monta-se a lista de pontos de odômetro e só se calcula
   com **dois pontos válidos**; o km é `último − primeiro`.
3. **Filtro de velocidade impossível:** um ponto é descartado se
   retrocede ou se implica mais de 120 km/h desde o anterior (com piso de
   meia hora no denominador, para não punir registros próximos).

Efeito colateral bom: o sistema se **autocorrige**. Um valor absurdo é
ignorado e o cálculo volta ao normal na próxima âncora boa.

---

## 8. Pausas

- **Oito motivos em chips:** almoço · abastecer · descanso · cochilo ·
  banheiro · pessoal · espera estratégica · outro.
- **Relógio para de contar.** Tempo pausado sai do tempo ativo, então
  R$/hora não é diluído por uma hora de almoço. Sem isso, parar para comer
  parece queda de desempenho.
- **Alerta de pausa longa** (45 min por padrão) — evita a pausa esquecida
  que corrói a métrica do dia.
- **Pausa aberta** é tratada como estado, não como registro: o app sabe
  que você está parado agora e mostra isso.
- Motivo de pausa alimenta a análise: dá para ver quanto tempo e quanto
  dinheiro cada tipo de parada custa.

---

## 9. Combustível e custos

### 9.1 Convenção tanque-cheio

A única forma honesta de medir consumo com abastecimento parcial não
existe — então o app adota a convenção clássica:

- **Distância:** do primeiro ao último abastecimento.
- **Gasto:** do **segundo** abastecimento em diante.

O primeiro abastecimento só marca o ponto de partida; o combustível dele
foi gasto antes da janela. Somar o primeiro gasto infla o custo por km.

### 9.2 O que sai disso

- **Consumo medido** (km/m³ ou km/l) entre abastecimentos reais,
  substituindo o valor de semente da configuração.
- **Custo real por km**, também substituindo a semente.
- **Suporte a mistura de combustível** (ex. 95% GNV / 5% gasolina), com
  preço por unidade de cada.
- **Outros custos** lançados à parte (lavagem, manutenção, aluguel...).
- **Líquido estimado** = bruto − combustível − desgaste.
- **Break-even por km** — o chão abaixo do qual a corrida paga menos que o
  custo de fazê-la. Serve de piso mínimo absoluto para qualquer faixa.
- **Custo de desgaste por km** configurável, somado ao combustível.

---

## 10. Rotina — planejamento semanal

Grade dos sete dias × horas do dia, editável por arrasto.

- **Sete tipos de bloco:** 🚕 Rodar · 🍽️ Alimentação · ☕ Descanso ·
  😴 Dormir · 🏋️ Academia · 📚 Estudos · 🧾 Pessoal. Só "Rodar" conta como
  trabalho.
- **Arrastar para mover, esticar para redimensionar, toque no vazio para
  criar.** Detalhe que só aparece testando: num dia lotado não sobra espaço
  livre, então **arrastar a borda entre dois blocos move os dois** — sem
  isso o arrasto simplesmente não faz nada.
- **Blocos que passam da meia-noite** são suportados (o limite interno é
  maior que 1440 min; travar em 1439 fabricava conflito falso).
- **Cálculo por dia e por semana:** horas de trabalho, descanso,
  alimentação, turnos contínuos, minutos por hora do dia.
- **Avisos determinísticos:** dia acima do limite, descanso entre turnos
  abaixo do mínimo, turno longo demais sem pausa.
- **Projeção de ganho da semana** com **cobertura declarada** — ela diz em
  quantas das horas planejadas existe histórico suficiente para projetar.
  Projeção sem cobertura é adivinhação com cara de número.
- **Detecção de conflito** entre blocos sobrepostos.

### 10.1 Integração com a aba Agora

A Rotina não é um calendário decorativo. A tela Agora lê o plano vigente e
mostra:

- Em que bloco você está **agora** segundo o plano.
- **Hora de parar** — o fim do bloco de trabalho corrente.
- O próximo bloco.

Com uma regra de posse: **um turno que atravessa a madrugada pertence ao
dia em que começou.** Sem isso, às 2h da manhã o app acha que você está no
plano de amanhã e manda dormir no meio do melhor horário.

---

## 11. Troféus — gamificação

### 11.1 Ofensiva (streak)

Dias trabalhados em sequência, com **tolerância de 2 dias de folga**. Um
streak que quebra por folga de domingo pune descanso — o que é exatamente
o contrário do que o app deveria fazer com um motorista cansado.

### 11.2 Medalhas

**225 medalhas em 36 famílias.** Cada família é uma escada de níveis
(ganho no dia, km, corridas, dias trabalhados, madrugadas, R$/h,
sequências, dias da semana, economia de combustível, etc.).

Decisões de design que importam:

- **Medalha é missão, não estatística.** O texto é convite ("faça X"), não
  relatório.
- **Cada medalha tem nome único no app inteiro.** Nomes repetidos entre
  famílias tornam o aviso de desbloqueio ambíguo.
- **Cinco patentes** com arte de metal diferente. A patente de uma medalha
  sai do nível dentro da família, normalizada:
  `1 + round(((nivel-1)/(niveis-1)) * 4)`. Sem normalizar, famílias de
  6 níveis repetem a patente máxima no topo.
- **Escadas calibradas acima do melhor recorde real**, nunca abaixo. Uma
  escada que termina em 60 R$/h para quem já fez 74 não tem nada a
  oferecer.
- **Medalha nunca é revogada.** Conquistado é conquistado.
- **Português com gênero e número corretos** — tabelas de artigo e plural
  por dia da semana ("em *um* domingo", "em *uma* segunda"). Texto
  concatenado sem isso soa a robô.
- **Arte em SVG escrito à mão**, inline: fita, serrilhado, disco, gradiente
  de metal por patente, e **anel de progresso nas bloqueadas**. Zero
  dependência, funciona offline, escala em qualquer tela.
- **Não existe bloco "perto de cair".** Mostrar o que você está a ponto de
  perder é ansiedade, não jogo.

### 11.3 Recordes

Melhor dia, melhor hora, maior sequência, melhor R$/h, etc.
**Recorde descreve; medalha convida.** São dois papéis distintos e não
devem virar a mesma lista.

### 11.4 XP, nível e moedas

- XP por dia trabalhado, por meta batida e por dia de ofensiva.
- Nível por degraus fixos de XP.
- Moedas por missão cumprida e por dia.
- **Nada é persistido:** tudo é derivado do histórico, sempre recalculável.
  Assim não existe estado de progresso para corromper, nem sincronizar.
- Não há nada para comprar com as moedas ainda — e está tudo bem. O
  contador funciona como reconhecimento sozinho.

---

## 12. Histórico, análise e exportação

### 12.1 Histórico

- Lista de dias com ganho, km, tempo e custo.
- **Médias de 7 e 30 dias.**
- **Fila de corridas sem valor** — corrida registrada sem o valor final
  fica pendente e não entra em nenhuma média até ser completada. Dado
  incompleto contamina estatística; melhor ficar de fora e visível.
- **Exportação CSV/TSV** para colar na planilha.

### 12.2 Análise

Dez blocos, cada um declarando sua fonte:

- Por dia da semana
- Por hora do dia (a partir dos trechos)
- Por motivo de pausa
- Por faixa horária
- **Heatmap hora × dia**
- Por bairro (com mínimo de amostra)
- Corrida longa vs. curta
- Impacto do dinâmico
- Aproveitamento de km
- Conferência de corridas × registros

A conferência é a que sustenta todo o resto: ela diz se o log de corridas
fecha com o saldo registrado. Quando não fecha, os cálculos que dependem de
corrida completa se desligam em vez de mentir.

---

## 13. Ajustes

Metas (três níveis) · hora-limite da meta · faixas por período · preço e
consumo de combustível · mistura · custo de desgaste por km · janela do
bloco · marcar posição · manter tela ligada · vibração · voz · tema ·
hora do modo noturno · modo dirigindo · alerta de pausa · nome · avatar ·
rotina.

Mudança de configuração dispara evento e **repinta as telas na hora** — sem
precisar reabrir o app.

---

## 14. Infraestrutura

- **PWA instalável**, sem build step, sem dependência externa, ES modules
  nativos.
- **Service worker cache-first e versionado.** Regra de operação: **a
  versão sobe em toda publicação**, senão o usuário fica com arquivo velho
  em cache e testa build antigo achando que é o novo. (Isso já aconteceu.)
- **IndexedDB escrito à mão**, sem wrapper.
- **Exportação manual é o único backup.** Nada sai do aparelho sozinho —
  é a garantia de privacidade e, ao mesmo tempo, o risco: perder o celular
  perde tudo. Na v2, **lembrete automático de backup** é a primeira coisa a
  acrescentar.
- **157 testes automatizados** sobre a camada pura, mais verificação de
  sintaxe de todos os arquivos.

### 14.1 Limites do PWA que a v2 nativa resolve

Estes são os motivos concretos para ir nativo:

| Limite no PWA | O que a v2 nativa ganha |
|---|---|
| Sem geolocalização em background; `watchPosition` congela com a aba fora de foco. | Rastreio de km automático, sem odômetro manual — resolve o gargalo de dados do app. |
| Wake lock só em primeiro plano. | Tela e serviço estáveis no turno inteiro. |
| Notificação só dispara com o app aberto. | **Camada de avisos determinísticos** de verdade: trecho fraco, esfriamento sustentado, janela de ouro chegando, fadiga. Nunca foi construída porque só faz sentido nativa. |
| Cache/armazenamento pode ser limpo pelo sistema. | Armazenamento durável + backup automático. |

---

## 15. Regras de projeto que valem levar inteiras para a v2

1. **Uma fonte de verdade para dinheiro.** Uma linha do tempo, uma dobra.
   Nenhuma tela soma por conta própria.
2. **Nunca misturar escala de jornada com escala de corrida.** Toda tela
   que mostra R$/km diz qual é.
3. **Nunca inventar número.** Falta dado → travessão, e mede o que dá.
4. **Amostra mínima explícita.** Abaixo dela, devolve `null`; a tela mostra
   ausência, não média de três casos.
5. **Prescrever (piso, corte, "aceite/recuse") exige amostra que você sabe
   completa.** Sem isso, apenas descreva a faixa observada.
6. **Semente é chute; medido substitui.** Todo parâmetro calibrado na mão
   deve ter caminho para ser substituído pelo histórico.
7. **Cálculo puro, separado de tela e banco.** É o que permite testar.
8. **Filtro de plausibilidade em toda entrada numérica manual.** E que o
   sistema se autocorrija na próxima entrada boa.
9. **Desfazer, não confirmar.**
10. **Medalha nunca é revogada. Recorde descreve, medalha convida.**
11. **Streak tolera folga.** O app não pode punir descanso.
12. **Turno que vira a madrugada pertence ao dia em que começou.**
13. **Cor é reforço, nunca a única informação.**
14. **Versão do cache sobe em toda publicação.**

---

## 16. O que foi removido por não sobreviver à rua

Registrar o que **não** funcionou vale tanto quanto o resto — evita
reconstruir o mesmo erro na v2.

- **Cronômetro de corrida ao vivo** (iniciar/finalizar corrida). Lia
  errado: GPS impreciso, esquecimento de finalizar, sinuosidade do trajeto
  estimada por fator. Produzia número pior que não ter número. Ficaram só
  os registros.
- **Rastreio contínuo de GPS.** Impossível no PWA (§14.1) e caro em
  bateria. Volta na v2 nativa — e aí resolve o odômetro manual.
- **Piso de aceite por km.** Dependia de log de corridas completo que não
  existe na prática. Removido (§6).
- **Piso de aceite como mediana.** Erro de lógica: metade das corridas fica
  abaixo da mediana por definição.
- **Texto explicativo longo na tela principal.** Mata a interface. A
  explicação foi para uma folha que abre com um toque; na tela ficam os
  números.
- **Bloco "perto de cair" nos troféus.** Ansiedade, não jogo.

---

## 17. Checklist de paridade para a v2

Marque quando a v2 fizer o mesmo:

**Ergonomia**
- [ ] Teclado numérico próprio, nunca o do sistema
- [ ] Alvos ≥ 64 px
- [ ] Horário por toque (`Date.now()`), nunca digitado
- [ ] Desfazer em vez de confirmar
- [ ] Tema escuro automático por horário
- [ ] Modo dirigindo
- [ ] Botão voltar do sistema fecha folha, não o app
- [ ] Vibração e voz opcionais
- [ ] Paleta validada para daltonismo; cor nunca é a única informação
- [ ] Travessão quando falta dado

**Núcleo**
- [ ] Linha do tempo única do dia; plataforma substitui, avulso acumula
- [ ] Várias jornadas por dia com saldo inicial
- [ ] Checkpoint parcial por plataforma + avulso
- [ ] Odômetro com filtro de plausibilidade e autocorreção
- [ ] Correção de jornada encerrada
- [ ] Bloco deslizante de 2 h + métricas do dia
- [ ] Projeção com horário-alvo ajustável e tempo ativo mínimo
- [ ] Faixas medidas por faixa horária, com amostra mínima
- [ ] Break-even como chão de qualquer faixa
- [ ] Piso de aceite por hora

**Pausas e custos**
- [ ] 8 motivos de pausa, relógio parado, alerta de pausa longa
- [ ] Convenção tanque-cheio para consumo
- [ ] Consumo e custo/km medidos substituindo a semente
- [ ] Mistura de combustível
- [ ] Outros custos e líquido estimado

**Planejamento e histórico**
- [ ] Rotina semanal com 7 tipos de bloco e arrasto (incluindo borda
      compartilhada)
- [ ] Blocos após a meia-noite
- [ ] Avisos de fadiga e descanso mínimo
- [ ] Projeção da semana com cobertura declarada
- [ ] Plano do dia na tela principal + hora de parar
- [ ] Histórico com médias de 7 e 30 dias
- [ ] Fila de corridas pendentes fora das médias
- [ ] Exportação CSV/TSV
- [ ] 10 blocos de análise com fonte declarada + heatmap hora × dia

**Gamificação**
- [ ] Ofensiva com 2 dias de tolerância
- [ ] 225 medalhas / 36 famílias, nomes únicos, arte por patente
- [ ] Anel de progresso nas bloqueadas
- [ ] Recordes separados das medalhas
- [ ] XP, nível e moedas derivados (nada persistido)

**Plataforma**
- [ ] Funciona 100% offline
- [ ] Dados só no aparelho
- [ ] Camada de cálculo pura e testada
- [ ] **Novo na v2:** backup automático
- [ ] **Novo na v2:** km por GPS em background
- [ ] **Novo na v2:** avisos determinísticos com notificação de sistema
