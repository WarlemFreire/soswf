// tela-rotina.js — o quadro da semana: quando rodar, quando parar, quanto dá.
//
// Planejar é uma coisa que se faz em casa, com calma, então esta tela pode ter
// grade e cor. O que ela nao pode é inventar número: a projeção diz em cima
// que fração dela veio das horas que o motorista realmente já rodou.

import { el, limpar, abrirFolha, chips } from "./ui.js";
import { cfg, salvarConfig } from "./config.js";
import * as store from "./store.js";
import * as A from "./analise.js";
import * as R from "./rotina.js";
import * as M from "./metrics.js";
import { db } from "./db.js";
import { vibrar, mostrarToast } from "./feedback.js";

const PASSO = 15;
/** Abaixo disso a hora do relógio tem histórico curto demais para virar taxa. */
const MINIMO_PARA_TAXA_MS = 60 * 60 * 1000;

let raizAtual = null;
let taxas = { porHora: [], padrao: 0, medida: false };

export async function montarRotina(raiz) {
  raizAtual = raiz;
  taxas = await lerTaxas();
  desenhar();
}

async function lerTaxas() {
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const horas = A.porHoraDosTrechos(jornadas, registros);

  const porHora = horas.map((h) => (h.ms >= MINIMO_PARA_TAXA_MS ? h.reaisPorHora : null));
  const valor = horas.reduce((s, h) => s + h.valor, 0);
  const ms = horas.reduce((s, h) => s + h.ms, 0);
  const geral = ms > 0 ? valor / (ms / M.HORA) : null;

  return {
    porHora,
    padrao: geral && geral > 0 ? geral : cfg("faixaHora").ideal,
    medida: geral != null && geral > 0,
  };
}

function rotinaAtual() {
  return R.normalizar(cfg("rotina") || R.rotinaVazia());
}

async function salvar(rotina) {
  await salvarConfig("rotina", R.normalizar(rotina));
  desenhar();
}

function desenhar() {
  if (!raizAtual) return;
  limpar(raizAtual);

  const rotina = rotinaAtual();
  const semana = R.resumoDaSemana(rotina);
  const projecao = R.projecao(rotina, { taxaPorHora: taxas.porHora, taxaPadrao: taxas.padrao });

  raizAtual.append(blocoResumo(semana, projecao));
  raizAtual.append(blocoGrade(rotina, semana));
  const alertas = R.avisos(rotina);
  if (alertas.length) raizAtual.append(blocoAvisos(alertas));
  if (semana.trabalho === 0) raizAtual.append(blocoPrimeiroUso());
}

/* --------------------------------------------------------------- resumo */

function blocoResumo(semana, projecao) {
  const tiles = [
    { valor: R.formatarDuracao(semana.trabalho), rotulo: "na semana" },
    { valor: semana.diasRodados ? R.formatarDuracao(semana.media) : "—", rotulo: "por dia rodado" },
    { valor: String(semana.folgas), rotulo: semana.folgas === 1 ? "folga" : "folgas" },
  ];

  return el(
    "section",
    { class: "rotina__secao" },
    el(
      "div",
      { class: "rotina__tiles" },
      ...tiles.map((t) =>
        el("div", { class: "rotina__tile" }, el("strong", {}, t.valor), el("span", {}, t.rotulo))
      )
    ),
    semana.trabalho > 0 ? cartaoProjecao(projecao) : null
  );
}

/**
 * O número grande vem com a régua do lado: com cobertura baixa quase todo o
 * plano caiu em horas que ele nunca rodou, e aí isto é estimativa de tabela,
 * nao medição do ritmo dele.
 */
function cartaoProjecao(projecao) {
  const pct = Math.round(projecao.cobertura * 100);
  const nota = !taxas.medida
    ? "Ainda sem histórico: conta feita pela meta de R$/hora dos Ajustes."
    : pct >= 70
      ? `${pct}% do plano cai em horas que você já rodou.`
      : `Só ${pct}% do plano cai em horas que você já rodou — o resto usa sua média geral.`;

  return el(
    "div",
    { class: "rotina__projecao" },
    el(
      "div",
      { class: "rotina__projecao-linha" },
      el("span", { class: "rotina__projecao-rotulo" }, "No seu ritmo, esta semana renderia"),
      el("strong", { class: "rotina__projecao-valor" }, `R$ ${M.formatarReais(projecao.ganho, { comCentavos: false })}`)
    ),
    el("p", { class: "rotina__nota" }, nota)
  );
}

/* ---------------------------------------------------------------- grade */

/**
 * A grade abre só na faixa de horas que a semana usa. Mostrar as 24 horas
 * sempre deixaria a rotina de quem roda das 16h às 2h espremida num quinto da
 * altura, com quatro quintos de vazio.
 */
function janelaDaGrade(rotina) {
  const blocos = R.DIAS.flatMap((d) => rotina.dias[d.id]);
  if (!blocos.length) return { inicio: 6 * 60, fim: 24 * 60 };
  const inicio = Math.min(...blocos.map((b) => b.inicio));
  const fim = Math.max(...blocos.map((b) => b.fim));
  return {
    inicio: Math.max(0, Math.floor((inicio - 30) / 60) * 60),
    fim: Math.min(R.MIN_DIA + 12 * 60, Math.ceil((fim + 30) / 60) * 60),
  };
}

function blocoGrade(rotina, semana) {
  const janela = janelaDaGrade(rotina);
  const alcance = janela.fim - janela.inicio;
  const posicao = (min) => `${((min - janela.inicio) / alcance) * 100}%`;

  const marcas = [];
  const passo = alcance > 12 * 60 ? 180 : 120;
  for (let m = Math.ceil(janela.inicio / passo) * passo; m <= janela.fim; m += passo) {
    marcas.push(
      el("span", { class: "grade__marca", style: { top: posicao(m) } }, R.formatarMinutos(m).replace(" ⁺¹", ""))
    );
  }

  return el(
    "section",
    { class: "rotina__secao" },
    el(
      "div",
      { class: "grade" },
      el("div", { class: "grade__regua" }, ...marcas),
      el(
        "div",
        { class: "grade__dias" },
        ...R.DIAS.map((dia) => colunaDoDia(dia, rotina.dias[dia.id], semana.porDia[dia.id], posicao))
      )
    ),
    // Dois tons só: na coluna estreita da semana nao cabe texto, entao a cor
    // é a única pista de identidade — e sete tons nao se separam para quem tem
    // daltonismo. Aqui a pergunta é "quando eu rodo", nao "o que eu faço".
    el(
      "div",
      { class: "grade__legenda" },
      el("span", { class: "grade__chave" }, el("i", { class: "ponto ponto--trabalho" }), "Rodar"),
      el("span", { class: "grade__chave" }, el("i", { class: "ponto ponto--fora" }), "Fora do volante")
    )
  );
}

function colunaDoDia(dia, blocos, resumo, posicao) {
  const trilha = el(
    "div",
    { class: "grade__trilha" },
    ...blocos.map((b) =>
      el("div", {
        class: `grade__bloco grade__bloco--${b.tipo === "trabalho" ? "trabalho" : "fora"}`,
        style: { top: posicao(b.inicio), height: `calc(${posicao(b.fim)} - ${posicao(b.inicio)})` },
        title: `${R.formatarMinutos(b.inicio)} → ${R.formatarMinutos(b.fim)}`,
      })
    )
  );

  return el(
    "button",
    {
      type: "button",
      class: `grade__coluna ${resumo.trabalho ? "" : "grade__coluna--folga"}`.trim(),
      onClick: () => abrirDia(dia),
      "aria-label": `${dia.nome}: ${resumo.trabalho ? R.formatarDuracao(resumo.trabalho) : "folga"}`,
    },
    el("span", { class: "grade__sigla" }, dia.curto),
    trilha,
    el("span", { class: "grade__total" }, resumo.trabalho ? R.formatarDuracao(resumo.trabalho) : "—")
  );
}

/* --------------------------------------------------------------- avisos */

function blocoAvisos(alertas) {
  return el(
    "section",
    { class: "rotina__secao" },
    el("h2", { class: "secao__titulo" }, "O que este plano cobra"),
    el(
      "div",
      { class: "rotina__avisos" },
      ...alertas.map((a) =>
        el(
          "div",
          { class: `rotina__aviso rotina__aviso--${a.grau}` },
          el("span", { "aria-hidden": "true" }, a.grau === "alerta" ? "⚠️" : "💡"),
          el("span", {}, a.texto)
        )
      )
    )
  );
}

function blocoPrimeiroUso() {
  return el(
    "div",
    { class: "vazio" },
    el("p", { class: "vazio__texto" }, "Semana em branco."),
    el("p", { class: "vazio__dica" }, "Toque num dia para dizer a que horas você pretende rodar.")
  );
}

/* ---------------------------------------------------------- editor do dia */

/** Altura de uma hora na linha do tempo. Com 15 min = 13px, o passo é firme. */
const PX_HORA = 52;
/** Folga acima e abaixo do conteúdo, para haver para onde arrastar. */
const FOLGA_JANELA = 180;
/** Movimento abaixo disto é toque, não arrasto. */
const LIMIAR_ARRASTO = 10;

let ultimoTipoDePausa = "descanso";

function abrirDia(dia) {
  const folha = abrirFolha({
    titulo: dia.nome,
    classe: "folha--alta folha--dia",
    conteudo: () => {
      const corpo = el("div", { class: "dia" });
      const pintar = () => {
        const blocos = rotinaAtual().dias[dia.id];
        const resumo = R.resumoDoDia(blocos);
        limpar(corpo);
        corpo.append(
          el(
            "p",
            { class: "dia__resumo" },
            resumo.vazio
              ? "Folga — arraste no vazio para criar um bloco."
              : `${R.formatarDuracao(resumo.trabalho)} de volante · ${R.formatarDuracao(resumo.pausa)} fora dele · ` +
                `${R.formatarMinutos(resumo.inicio)} → ${R.formatarMinutos(resumo.fim)}`
          ),
          // A dica fica ANTES da linha do tempo: depois dela ficaria no fim de
          // um rolar de várias telas, onde ninguém que precisa dela vai olhar.
          el("p", { class: "dia__dica" }, "Arraste o bloco para mover, as pontas para esticar, o vazio para criar. Toque para trocar o tipo."),
          linhaDoTempo(dia, blocos, pintar),
          el(
            "div",
            { class: "dia__adicionar" },
            el("button", { type: "button", class: "botao botao--secundario", onClick: () => editarBloco(dia, null, "trabalho", pintar) }, "🚕 Rodar"),
            el("button", { type: "button", class: "botao botao--secundario", onClick: () => editarBloco(dia, null, null, pintar) }, "＋ Pausa")
          )
        );
      };
      pintar();
      return corpo;
    },
    rodape: [
      el("button", { type: "button", class: "botao botao--texto", onClick: () => copiarDia(dia) }, "Copiar para…"),
      el(
        "button",
        {
          type: "button",
          class: "botao botao--texto",
          onClick: async () => {
            const rotina = rotinaAtual();
            rotina.dias[dia.id] = [];
            await salvar(rotina);
            folha.fechar();
          },
        },
        "Limpar dia"
      ),
    ],
  });
  return folha;
}

/** De que minuto a que minuto a linha do tempo desenha. */
function janelaDoDia(blocos) {
  if (!blocos.length) return { inicio: 5 * 60, fim: 23 * 60 };
  const menor = Math.min(...blocos.map((b) => b.inicio));
  const maior = Math.max(...blocos.map((b) => b.fim));
  return {
    inicio: Math.max(0, Math.floor((menor - FOLGA_JANELA) / 60) * 60),
    fim: Math.min(R.LIMITE_BLOCO, Math.ceil((maior + FOLGA_JANELA) / 60) * 60),
  };
}

/**
 * A linha do tempo do dia, com blocos que se arrastam.
 *
 * Durante o arrasto só o estilo muda; a gravação e o redesenho acontecem ao
 * soltar. Redesenhar a cada movimento destruiria o elemento que está com o
 * ponteiro capturado e o arrasto morreria no meio.
 */
function linhaDoTempo(dia, blocos, pintar) {
  const janela = janelaDoDia(blocos);
  const altura = ((janela.fim - janela.inicio) / 60) * PX_HORA;
  const paraY = (min) => ((min - janela.inicio) / 60) * PX_HORA;
  const paraMin = (y) => janela.inicio + (y / PX_HORA) * 60;
  const arredondar = (min) => Math.round(min / PASSO) * PASSO;

  const horas = [];
  for (let m = janela.inicio; m <= janela.fim; m += 60) {
    horas.push(
      el(
        "div",
        { class: `tl__hora ${m % 360 === 0 ? "tl__hora--forte" : ""}`.trim(), style: { top: `${paraY(m)}px` } },
        el("span", {}, R.formatarMinutos(m).replace(" ⁺¹", ""))
      )
    );
  }

  const flutuante = el("div", { class: "tl__flutuante", hidden: true });
  const tela = el("div", { class: "tl__tela" });
  const raiz = el("div", { class: "tl", style: { height: `${altura}px` } }, ...horas, tela, flutuante);

  const ordenados = [...blocos].sort((a, b) => a.inicio - b.inicio);
  const caixas = ordenados.map((bloco) => desenharBloco(bloco, paraY));
  tela.append(...caixas);
  ordenados.forEach((bloco, i) => {
    ligarArrasto({
      caixa: caixas[i],
      bloco,
      antes: ordenados[i - 1] ? { bloco: ordenados[i - 1], caixa: caixas[i - 1] } : null,
      depois: ordenados[i + 1] ? { bloco: ordenados[i + 1], caixa: caixas[i + 1] } : null,
      janela,
      dia,
      paraY,
      arredondar,
      flutuante,
      pintar,
    });
  });

  // Arrastar no vazio cria. Um toque simples não cria nada: criar bloco por
  // encostar na tela faria a rotina ganhar lixo a cada rolagem desajeitada.
  tela.addEventListener("pointerdown", (ev) => {
    if (ev.target !== tela) return;
    const y0 = ev.clientY;
    const base = arredondar(paraMin(ev.offsetY));
    let atual = null;
    tela.setPointerCapture(ev.pointerId);

    const mover = (e) => {
      const dy = e.clientY - y0;
      if (!atual && Math.abs(dy) < LIMIAR_ARRASTO) return;
      const solto = arredondar(paraMin(ev.offsetY + dy));
      const inicio = Math.max(janela.inicio, Math.min(base, solto));
      const fim = Math.min(janela.fim, Math.max(base, solto) + PASSO);
      if (!atual) {
        atual = el("div", { class: "tl__bloco tl__bloco--novo tl__bloco--trabalho" });
        tela.append(atual);
      }
      atual.style.top = `${paraY(inicio)}px`;
      atual.style.height = `${paraY(fim) - paraY(inicio)}px`;
      mostrarFlutuante(flutuante, inicio, fim);
    };

    const soltar = async (e) => {
      tela.removeEventListener("pointermove", mover);
      tela.removeEventListener("pointerup", soltar);
      tela.removeEventListener("pointercancel", soltar);
      flutuante.hidden = true;
      if (!atual) return;
      const dy = e.clientY - y0;
      const solto = arredondar(paraMin(ev.offsetY + dy));
      const inicio = Math.max(janela.inicio, Math.min(base, solto));
      const fim = Math.min(janela.fim, Math.max(base, solto) + PASSO);
      atual.remove();
      if (fim - inicio < PASSO) return;
      const rotina = rotinaAtual();
      rotina.dias[dia.id] = [...rotina.dias[dia.id], { id: `${dia.id}-${Date.now()}`, tipo: "trabalho", inicio, fim }];
      await salvar(rotina);
      vibrar(20);
      pintar();
    };

    tela.addEventListener("pointermove", mover);
    tela.addEventListener("pointerup", soltar);
    tela.addEventListener("pointercancel", soltar);
  });

  return raiz;
}

function desenharBloco(bloco, paraY) {
  const tipo = R.tipoDe(bloco.tipo);
  const alto = paraY(bloco.fim) - paraY(bloco.inicio);

  return el(
    "div",
    {
      class: `tl__bloco tl__bloco--${tipo.id}`,
      style: { top: `${paraY(bloco.inicio)}px`, height: `${alto}px` },
      role: "button",
      tabIndex: 0,
      "aria-label": `${tipo.nome}, ${R.formatarMinutos(bloco.inicio)} a ${R.formatarMinutos(bloco.fim)}`,
    },
    el("span", { class: "tl__alca tl__alca--topo" }),
    el(
      "span",
      { class: "tl__rotulo" },
      // O ícone aparece mesmo no bloco mais baixo: com sete tipos, a cor
      // sozinha nao separa todos os pares para quem tem daltonismo.
      el("span", { class: "tl__icone", "aria-hidden": "true" }, tipo.icone),
      alto >= 34 ? el("span", { class: "tl__nome" }, tipo.nome) : null,
      alto >= 52 ? el("span", { class: "tl__horas" }, `${R.formatarMinutos(bloco.inicio)} → ${R.formatarMinutos(bloco.fim)}`) : null
    ),
    el("span", { class: "tl__alca tl__alca--base" })
  );
}

function ligarArrasto({ caixa, bloco, antes, depois, janela, dia, paraY, arredondar, flutuante, pintar }) {
  let modo = null;
  let y0 = 0;
  let inicial = null;
  let arrastou = false;

  const limites = () => ({
    min: antes ? antes.bloco.fim : janela.inicio,
    max: depois ? depois.bloco.inicio : janela.fim,
    // Blocos colados dividem uma borda. Arrastar essa borda move os DOIS, que
    // é como se ajusta um dia cheio: sem isto, numa rotina sem buracos nada se
    // mexe e o arrasto parece quebrado.
    coladoAntes: antes && antes.bloco.fim === bloco.inicio ? antes.bloco : null,
    coladoDepois: depois && depois.bloco.inicio === bloco.fim ? depois.bloco : null,
  });

  const aplicar = (novo, lim) => {
    caixa.style.top = `${paraY(novo.inicio)}px`;
    caixa.style.height = `${paraY(novo.fim) - paraY(novo.inicio)}px`;
    if (novo.vizinhoAntes && antes) antes.caixa.style.height = `${paraY(novo.vizinhoAntes.fim) - paraY(antes.bloco.inicio)}px`;
    if (novo.vizinhoDepois && depois) {
      depois.caixa.style.top = `${paraY(novo.vizinhoDepois.inicio)}px`;
      depois.caixa.style.height = `${paraY(depois.bloco.fim) - paraY(novo.vizinhoDepois.inicio)}px`;
    }
  };

  caixa.addEventListener("pointerdown", (ev) => {
    const alvo = ev.target.classList;
    modo = alvo.contains("tl__alca--topo") ? "topo" : alvo.contains("tl__alca--base") ? "base" : "mover";
    y0 = ev.clientY;
    inicial = { inicio: bloco.inicio, fim: bloco.fim };
    arrastou = false;
    caixa.setPointerCapture(ev.pointerId);
    caixa.classList.add("tl__bloco--pegando");
    ev.stopPropagation();
  });

  caixa.addEventListener("pointermove", (ev) => {
    if (!modo) return;
    const dy = ev.clientY - y0;
    if (!arrastou && Math.abs(dy) < LIMIAR_ARRASTO) return;
    arrastou = true;
    const novo = calcular(modo, inicial, arredondar((dy / PX_HORA) * 60), limites());
    aplicar(novo);
    mostrarFlutuante(flutuante, novo.inicio, novo.fim);
  });

  const soltar = async (ev) => {
    if (!modo) return;
    const anterior = modo;
    modo = null;
    caixa.classList.remove("tl__bloco--pegando");
    flutuante.hidden = true;

    if (!arrastou) {
      editarBloco(dia, bloco, bloco.tipo, pintar);
      return;
    }
    const novo = calcular(anterior, inicial, arredondar(((ev.clientY - y0) / PX_HORA) * 60), limites());
    const mudancas = new Map([[bloco.id, { inicio: novo.inicio, fim: novo.fim }]]);
    if (novo.vizinhoAntes) mudancas.set(antes.bloco.id, novo.vizinhoAntes);
    if (novo.vizinhoDepois) mudancas.set(depois.bloco.id, novo.vizinhoDepois);

    const rotina = rotinaAtual();
    rotina.dias[dia.id] = rotina.dias[dia.id].map((b) => (mudancas.has(b.id) ? { ...b, ...mudancas.get(b.id) } : b));
    await salvar(rotina);
    vibrar(20);
    pintar();
  };
  caixa.addEventListener("pointerup", soltar);
  caixa.addEventListener("pointercancel", soltar);
}

/**
 * Mover desliza os dois extremos juntos; as alças mexem num só. Quando a alça
 * puxada é uma borda compartilhada com o vizinho, o vizinho vem junto.
 */
function calcular(modo, inicial, passo, limites) {
  const duracao = inicial.fim - inicial.inicio;

  if (modo === "mover") {
    const inicio = Math.max(limites.min, Math.min(limites.max - duracao, inicial.inicio + passo));
    return { inicio, fim: inicio + duracao };
  }

  if (modo === "topo") {
    const colado = limites.coladoAntes;
    const chao = colado ? colado.inicio + PASSO : limites.min;
    const inicio = Math.max(chao, Math.min(inicial.fim - PASSO, inicial.inicio + passo));
    return { inicio, fim: inicial.fim, vizinhoAntes: colado ? { fim: inicio } : null };
  }

  const colado = limites.coladoDepois;
  const teto = colado ? colado.fim - PASSO : limites.max;
  const fim = Math.min(teto, Math.max(inicial.inicio + PASSO, inicial.fim + passo));
  return { inicio: inicial.inicio, fim, vizinhoDepois: colado ? { inicio: fim } : null };
}

function mostrarFlutuante(elemento, inicio, fim) {
  elemento.hidden = false;
  elemento.textContent = `${R.formatarMinutos(inicio)} → ${R.formatarMinutos(fim)} · ${R.formatarDuracao(fim - inicio)}`;
}

function editarBloco(dia, bloco, tipoInicial, pintar) {
  const novo = !bloco;
  const anterior = rotinaAtual().dias[dia.id].at(-1);
  const inicio = bloco?.inicio ?? (anterior ? anterior.fim : 6 * 60);
  const valores = {
    // Pausa sem tipo escolhido vira alimentação só se cair na hora de comer.
    // Chamar de "Alimentação" uma parada das 23h15 é o app não olhar o relógio.
    tipo: bloco?.tipo ?? tipoInicial ?? (horaDaRefeicao(inicio) ? "alimentacao" : ultimoTipoDePausa),
    inicio,
    fim: bloco?.fim ?? inicio + (tipoInicial === "trabalho" ? 4 * 60 : 60),
  };

  const duracao = el("p", { class: "folha__ajuda" }, "");
  const campoInicio = stepper("Começa", () => valores.inicio, (v) => mexer("inicio", v));
  const campoFim = stepper("Termina", () => valores.fim, (v) => mexer("fim", v));

  function mexer(qual, valor) {
    valores[qual] = valor;
    // Fim antes do começo não é bloco. Empurrar o outro extremo evita a tela
    // travada num estado impossível enquanto ele ainda está ajustando.
    if (valores.fim <= valores.inicio) {
      if (qual === "inicio") valores.fim = valores.inicio + PASSO;
      else valores.inicio = valores.fim - PASSO;
    }
    campoInicio.atualizar();
    campoFim.atualizar();
    atualizar();
  }
  function atualizar() {
    duracao.textContent = `${R.formatarDuracao(valores.fim - valores.inicio)} · ${R.formatarMinutos(valores.inicio)} → ${R.formatarMinutos(valores.fim)}`;
  }
  atualizar();

  const folha = abrirFolha({
    titulo: novo ? "Novo bloco" : R.tipoDe(valores.tipo).nome,
    classe: "folha--alta",
    conteudo: [
      chips(
        R.TIPOS.map((t) => ({ id: t.id, nome: t.nome, icone: t.icone })),
        {
          selecionado: valores.tipo,
          classe: "chips--tipos",
          aoEscolher: (id) => {
            valores.tipo = id;
            if (id !== "trabalho") ultimoTipoDePausa = id;
          },
        }
      ),
      campoInicio.el,
      campoFim.el,
      duracao,
    ],
    rodape: [
      novo
        ? null
        : el(
            "button",
            {
              type: "button",
              class: "botao botao--perigo",
              onClick: async () => {
                const rotina = rotinaAtual();
                rotina.dias[dia.id] = rotina.dias[dia.id].filter((b) => b.id !== bloco.id);
                await salvar(rotina);
                pintar();
                folha.fechar();
              },
            },
            "Remover"
          ),
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario",
          onClick: async () => {
            const rotina = rotinaAtual();
            const lista = rotina.dias[dia.id].filter((b) => b.id !== bloco?.id);
            lista.push({ id: bloco?.id || `${dia.id}-${Date.now()}`, ...valores });
            rotina.dias[dia.id] = lista;
            await salvar(rotina);
            vibrar(30);
            pintar();
            folha.fechar();
          },
        },
        "Salvar"
      ),
    ].filter(Boolean),
  });
}

function horaDaRefeicao(min) {
  const hora = Math.floor((min % R.MIN_DIA) / 60);
  return (hora >= 11 && hora < 15) || (hora >= 19 && hora < 22);
}

/** Stepper de horário: 15 em 15 minutos, sem teclado do sistema. */
function stepper(rotulo, ler, escrever) {
  const visor = el("strong", { class: "campo__valor" }, "");
  const mexer = (passos) => {
    const bruto = ler() + passos * PASSO;
    escrever(Math.max(0, Math.min(R.LIMITE_BLOCO, bruto)));
  };
  const caixa = el(
    "div",
    { class: "campo" },
    el("span", { class: "campo__rotulo" }, rotulo),
    el(
      "div",
      { class: "campo__stepper" },
      el("button", { type: "button", class: "stepper", onClick: () => mexer(-1), "aria-label": `${rotulo}: 15 minutos antes` }, "−"),
      visor,
      el("button", { type: "button", class: "stepper", onClick: () => mexer(1), "aria-label": `${rotulo}: 15 minutos depois` }, "+")
    )
  );
  const atualizar = () => (visor.textContent = R.formatarMinutos(ler()));
  atualizar();
  return { el: caixa, atualizar };
}

/* ------------------------------------------------------- copiar um dia */

function copiarDia(origem) {
  const alvos = new Set();
  const folha = abrirFolha({
    titulo: `Copiar ${origem.nome} para`,
    conteudo: el(
      "div",
      { class: "copiar" },
      ...R.DIAS.filter((d) => d.id !== origem.id).map((d) =>
        el(
          "button",
          {
            type: "button",
            class: "copiar__dia",
            onClick: (ev) => {
              const botao = ev.currentTarget;
              if (alvos.has(d.id)) alvos.delete(d.id);
              else alvos.add(d.id);
              botao.classList.toggle("copiar__dia--ativo", alvos.has(d.id));
              vibrar(8);
            },
          },
          d.nome
        )
      )
    ),
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario",
          onClick: async () => {
            if (!alvos.size) return folha.fechar();
            const rotina = rotinaAtual();
            const modelo = rotina.dias[origem.id];
            for (const alvo of alvos) {
              rotina.dias[alvo] = modelo.map((b, i) => ({ ...b, id: `${alvo}-${Date.now()}-${i}` }));
            }
            await salvar(rotina);
            folha.fechar();
            mostrarToast({ titulo: `${origem.nome} copiado para ${alvos.size} ${alvos.size === 1 ? "dia" : "dias"}` });
          },
        },
        "Copiar"
      ),
    ],
  });
}
