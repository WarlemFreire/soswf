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
    el(
      "div",
      { class: "grade__legenda" },
      ...R.TIPOS.map((t) =>
        el("span", { class: "grade__chave" }, el("i", { class: `ponto ponto--${t.id}` }), t.nome)
      )
    )
  );
}

function colunaDoDia(dia, blocos, resumo, posicao) {
  const trilha = el(
    "div",
    { class: "grade__trilha" },
    ...blocos.map((b) =>
      el("div", {
        class: `grade__bloco grade__bloco--${b.tipo}`,
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

function abrirDia(dia) {
  const folha = abrirFolha({
    titulo: dia.nome,
    classe: "folha--alta",
    conteudo: (api) => {
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
              ? "Folga — nada planejado."
              : `${R.formatarDuracao(resumo.trabalho)} de volante · ${R.formatarDuracao(resumo.pausa)} de pausa · ` +
                `${R.formatarMinutos(resumo.inicio)} → ${R.formatarMinutos(resumo.fim)}`
          ),
          el(
            "div",
            { class: "dia__blocos" },
            ...blocos.map((b) => linhaDoBloco(dia, b, pintar))
          ),
          el(
            "div",
            { class: "dia__adicionar" },
            el("button", { type: "button", class: "botao botao--secundario", onClick: () => editarBloco(dia, null, "trabalho", pintar) }, "🚕 Rodar"),
            el("button", { type: "button", class: "botao botao--secundario", onClick: () => editarBloco(dia, null, null, pintar) }, "🍽️ Pausa")
          )
        );
      };
      pintar();
      api.repintar = pintar;
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

function linhaDoBloco(dia, bloco, pintar) {
  const tipo = R.TIPOS.find((t) => t.id === bloco.tipo);
  return el(
    "button",
    { type: "button", class: `dia__bloco dia__bloco--${bloco.tipo}`, onClick: () => editarBloco(dia, bloco, bloco.tipo, pintar) },
    el("span", { class: "dia__icone", "aria-hidden": "true" }, tipo.icone),
    el(
      "span",
      { class: "dia__texto" },
      el("strong", {}, `${R.formatarMinutos(bloco.inicio)} → ${R.formatarMinutos(bloco.fim)}`),
      el("span", { class: "dia__tipo" }, tipo.nome)
    ),
    el("span", { class: "dia__duracao" }, R.formatarDuracao(bloco.fim - bloco.inicio))
  );
}

function editarBloco(dia, bloco, tipoInicial, pintar) {
  const novo = !bloco;
  const anterior = rotinaAtual().dias[dia.id].at(-1);
  const inicio = bloco?.inicio ?? (anterior ? anterior.fim : 6 * 60);
  const valores = {
    // Pausa sem tipo escolhido vira almoço só se cair na hora do almoço.
    // Chamar de "Almoço" uma parada das 23h15 é o app não olhar o relógio.
    tipo: bloco?.tipo ?? tipoInicial ?? (horaDoAlmoco(inicio) ? "almoco" : "descanso"),
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
    titulo: novo ? "Novo bloco" : "Editar bloco",
    conteudo: [
      chips(
        R.TIPOS.map((t) => ({ id: t.id, nome: t.nome, icone: t.icone })),
        { selecionado: valores.tipo, aoEscolher: (id) => (valores.tipo = id) }
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

function horaDoAlmoco(min) {
  const hora = Math.floor((min % R.MIN_DIA) / 60);
  return hora >= 11 && hora < 15;
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
