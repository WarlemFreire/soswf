// tela-financeiro.js — a aba que responde "quanto sobrou de verdade".
//
// Tomou o lugar dos Troféus. A troca é a tese do app inteiro: o que importa no
// fim do turno não é um contador de medalhas, é a conta descendo do bruto que a
// plataforma mostra até o que de fato ficou no bolso.
//
// A ordem da tela é a ordem da conta, de cima para baixo, porque é assim que ele
// já pensa: ganhei tanto, gastei tanto, sobrou tanto, e disso tanto não é meu.

import { el, limpar, abrirFolha } from "./ui.js";
import { cfg, configAtual, salvarConfig } from "./config.js";
import * as store from "./store.js";
import * as M from "./metrics.js";
import * as F from "./financeiro.js";
import { db } from "./db.js";
import { Teclado } from "./keypad.js";
import { vibrar, mostrarToast } from "./feedback.js";
import { abrirOrcamento, orcamentosSalvos, apagarOrcamento } from "./tela-orcamento.js";

/** Quantos períodos a barra do "para onde vai" mostra. */
const PERIODOS_NA_SERIE = { semana: 8, mes: 6 };

let janelaAtual = "semana";

export async function montarFinanceiro(raiz) {
  limpar(raiz);
  raiz.append(el("p", { class: "carregando" }, "Somando…"));

  const resumos = await store.historico();
  const custos = await db.todos("custos");
  const orcamentos = await orcamentosSalvos();
  const config = configAtual();
  const energiaKm = M.analiseAbastecimentos(custos).porKm;

  limpar(raiz);
  raiz.append(
    seletorDeJanela(() => montarFinanceiro(raiz)),
    ...conteudo(resumos, { config, energiaKm }),
    cartaoOrcamento(orcamentos, () => montarFinanceiro(raiz))
  );
}

function conteudo(resumos, { config, energiaKm }) {
  const periodos = F.porPeriodo(resumos, janelaAtual, PERIODOS_NA_SERIE[janelaAtual]);
  if (!periodos.length) {
    return [
      el("section", { class: "cartao" },
        el("p", { class: "vazio" }, "Ainda não há jornada fechada para somar."),
      ),
    ];
  }

  const impostoPct = config.impostoPct || 0;
  const fechado = (p) => F.fechamento(p.resumos, { config, energiaKmMedido: energiaKm, impostoPct });

  const atual = fechado(periodos[0]);
  const anterior = periodos[1] ? fechado(periodos[1]) : null;

  return [
    cartaoCascata(periodos[0], atual, anterior),
    cartaoReserva(atual, impostoPct),
    cartaoParaOndeVai(periodos, fechado),
    cartaoConciliacao(periodos[0], atual),
  ];
}

/* ------------------------------------------------------------- orçamento */

/**
 * Orçamento de corrida particular.
 *
 * Fica no Financeiro e não numa aba própria porque é decisão de preço, e
 * porque ele orça parado — esperando o cliente responder, não dirigindo.
 */
function cartaoOrcamento(orcamentos, repintar) {
  return el(
    "section",
    { class: "cartao" },
    el("h2", { class: "cartao__titulo" }, "Orçar particular"),
    el("p", { class: "cartao__nota" },
      "Conta o km e o tempo que a corrida ocupa de verdade, incluindo a ida até " +
      "o cliente e a volta vazia."),

    orcamentos.length
      ? el("div", { class: "orc__salvos" },
          ...orcamentos.map((o) =>
            el("div", { class: "orc__salvo" },
              el("div", { class: "orc__salvo-texto" },
                el("strong", {}, `R$ ${M.formatarReais(o.preco, { comCentavos: false })}`),
                el("small", {},
                  `${o.km} km · ${o.minutos} min · ` +
                  `${o.reaisPorHora == null ? "—" : `${o.reaisPorHora.toFixed(0)} R$/h`} · ` +
                  M.formatarData(o.timestamp)),
              ),
              el("button", {
                type: "button",
                class: "orc__apagar",
                "aria-label": "Apagar orçamento",
                onClick: async () => {
                  await apagarOrcamento(o.id);
                  vibrar(8);
                  repintar();
                },
              }, "✕"),
            )
          ),
        )
      : null,

    el("button", {
      type: "button",
      class: "botao botao--primario fin__acao",
      onClick: () => abrirOrcamento(repintar),
    }, "Fazer um orçamento"),
  );
}

/* ------------------------------------------------------- entrada de número */

/**
 * Uma folha com o teclado próprio do app. Nunca o teclado do sistema, nem aqui:
 * ele pode estar lançando isso no carro, parado no ponto.
 *
 * Resolve com o número, ou com null se ele fechou sem confirmar.
 */
function pedirNumero({ titulo, valorInicial = null, modo = "dinheiro", ajuda = "" }) {
  return new Promise((resolve) => {
    let valor = valorInicial;
    let confirmou = false;

    const mostrador = el("div", { class: "folha__mostrador" }, "0");
    const teclado = new Teclado({
      modo,
      aoMudar: (n, texto) => {
        valor = n;
        mostrador.textContent = texto || "0";
      },
    });
    if (valorInicial != null) teclado.definir(valorInicial);
    mostrador.textContent = teclado.texto || "0";

    abrirFolha({
      titulo,
      conteudo: [mostrador, ajuda ? el("p", { class: "folha__ajuda" }, ajuda) : null, teclado.el].filter(Boolean),
      rodape: (folha) => [
        el("button", {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: () => {
            confirmou = true;
            folha.fechar();
          },
        }, "Salvar"),
      ],
      aoFechar: () => resolve(confirmou ? valor : null),
    });
  });
}

/* ------------------------------------------------------------- a cascata */

/**
 * A conta descendo. Cada linha traz o número E a fonte dele — a regra de nunca
 * mostrar valor sem dizer de onde veio vale em dobro aqui, porque "combustível
 * estimado" e "combustível lançado" levam a decisões diferentes.
 */
function cartaoCascata(periodo, f, anterior) {
  const linhas = [
    linhaConta("Bruto", f.bruto, { forte: true }),
    linhaConta(`Combustível`, -f.combustivel.valor, {
      nota: f.combustivel.fonte === "lancado" ? "lançado" : "estimado pelo km",
      alerta: f.combustivel.fonte !== "lancado",
    }),
    f.outros.valor > 0 ? linhaConta("Outros custos", -f.outros.valor, { nota: "lançado" }) : null,
    linhaConta("Líquido", f.liquido, { forte: true, destaque: true }),
  ];

  return el(
    "section",
    { class: "cartao" },
    el("div", { class: "fin__topo" },
      el("h2", { class: "cartao__titulo" }, janelaAtual === "mes" ? "Mês" : "Semana"),
      el("span", { class: "fin__rotulo" }, periodo.rotulo),
    ),
    el("div", { class: "fin__conta" }, ...linhas.filter(Boolean)),
    el("div", { class: "fin__pes" },
      pe("R$/h líquido", f.reaisPorHora, 0),
      pe("R$/km líquido", f.reaisPorKm, 2),
      pe("Dias", f.dias, 0, { cru: true }),
    ),
    comparacao(f, anterior),
    !f.completo
      ? el("p", { class: "cartao__nota cartao__nota--alerta" },
          `${f.diasSemKm} ${f.diasSemKm === 1 ? "dia" : "dias"} sem km: o custo desse período está por baixo.`)
      : null,
  );
}

function linhaConta(rotulo, valor, { forte = false, destaque = false, nota = "", alerta = false } = {}) {
  return el(
    "div",
    { class: `fin__linha ${destaque ? "fin__linha--destaque" : ""}`.trim() },
    el("span", { class: "fin__linha-rotulo" },
      rotulo,
      nota ? el("small", { class: `fin__fonte ${alerta ? "fin__fonte--alerta" : ""}`.trim() }, nota) : null,
    ),
    el("strong", { class: `fin__linha-valor ${forte ? "fin__linha-valor--forte" : ""}`.trim() },
      `${valor < 0 ? "−" : ""}R$ ${M.formatarReais(Math.abs(valor))}`),
  );
}

function pe(rotulo, valor, casas, { cru = false } = {}) {
  const texto = valor == null
    ? "—"
    : cru
      ? String(valor)
      : valor.toFixed(casas).replace(".", ",");
  return el("div", { class: "fin__pe" },
    el("span", { class: "fin__pe-valor" }, texto),
    el("span", { class: "fin__pe-rotulo" }, rotulo),
  );
}

/**
 * Contra o período anterior, POR DIA TRABALHADO.
 *
 * Comparar o total seria mentira na maior parte do tempo: na terça-feira a
 * semana corrente tem dois dias e a anterior tem sete, e o app anunciaria "82%
 * abaixo" quando não há nada de errado. Por dia trabalhado a comparação vale
 * desde o primeiro dia do período.
 */
function comparacao(f, anterior) {
  if (!anterior || !(f.dias > 0) || !(anterior.dias > 0)) return null;

  const agora = f.liquido / f.dias;
  const antes = anterior.liquido / anterior.dias;
  if (!(Math.abs(antes) > 0)) return null;

  const delta = agora - antes;
  const pct = (delta / Math.abs(antes)) * 100;
  const sobe = delta >= 0;
  return el(
    "p",
    { class: `fin__delta ${sobe ? "fin__delta--sobe" : "fin__delta--desce"}` },
    `${sobe ? "▲" : "▼"} R$ ${M.formatarReais(Math.abs(delta))}/dia (${Math.abs(pct).toFixed(0)}%) ` +
      `${janelaAtual === "mes" ? "que o mês anterior" : "que a semana anterior"}`,
  );
}

/* ------------------------------------------------------------- a reserva */

/**
 * O que não é dele, mesmo estando na conta.
 *
 * O desgaste aparece AQUI e não na cascata de propósito: ele é provisão para a
 * manutenção que ainda vem, não despesa já feita. Descontá-lo do líquido e
 * ainda lançar a manutenção quando ela chega tiraria a mesma despesa duas
 * vezes. Ver o cabeçalho de financeiro.js.
 */
function cartaoReserva(f, impostoPct) {
  return el(
    "section",
    { class: "cartao" },
    el("h2", { class: "cartao__titulo" }, "Guardar"),
    el("div", { class: "fin__conta" },
      linhaConta("Desgaste do carro", f.reserva.desgaste, {
        nota: `${(cfg("custoDesgasteKm") || 0).toFixed(2).replace(".", ",")}/km × ${f.km.toFixed(0)} km`,
      }),
      linhaConta("Imposto", f.reserva.imposto, { nota: `${impostoPct}% do bruto` }),
      linhaConta("Sobra livre", f.sobra, { forte: true, destaque: true }),
    ),
    el("p", { class: "cartao__nota" },
      "O desgaste não sai do líquido acima: é dinheiro que deveria estar guardado " +
      "para quando a manutenção chegar. Quando ela chega, ela é lançada e aí sim desce."),
    el("button", {
      type: "button",
      class: "botao fin__acao",
      onClick: () => ajustarImposto(),
    }, "Ajustar o imposto"),
  );
}

async function ajustarImposto() {
  const atual = cfg("impostoPct") || 0;
  const novo = await pedirNumero({
    titulo: "Guardar para imposto",
    valorInicial: atual,
    modo: "inteiro",
    ajuda: "Percentual do bruto. Entra na reserva, não desce do líquido.",
  });
  if (novo == null) return;
  await salvarConfig("impostoPct", Math.min(100, Math.max(0, novo)));
  vibrar(20);
  mostrarToast({ titulo: "Imposto atualizado" });
  document.dispatchEvent(new CustomEvent("copiloto:financeiro"));
}

/* ------------------------------------------------------- para onde vai */

/**
 * Composição do custo por período.
 *
 * Barras empilhadas, no máximo quatro categorias, cada uma com nome e valor ao
 * lado da cor. A paleta categórica do app só tem quatro tons que se separam sob
 * daltonismo em claro e escuro (validado), e em tela de celular a cor sozinha
 * nunca basta: a legenda traz o nome sempre.
 */
function cartaoParaOndeVai(periodos, fechado) {
  const todosCustos = periodos.flatMap((p) => p.resumos.flatMap((r) => r.custos || []));
  const { total, fatias } = F.porCategoria(todosCustos);

  if (!(total > 0)) {
    return el("section", { class: "cartao" },
      el("h2", { class: "cartao__titulo" }, "Para onde vai"),
      el("p", { class: "vazio" }, "Nenhum custo lançado ainda."),
    );
  }

  const cores = new Map(fatias.map((f, i) => [f.id, `var(--cat-${i + 1})`]));

  // Série: um empilhado por período, do mais antigo para o mais recente, para
  // o tempo correr da esquerda para a direita como ele espera.
  const serie = [...periodos].reverse().map((p) => {
    const custos = p.resumos.flatMap((r) => r.custos || []);
    const porCat = F.porCategoria(custos);
    return { rotulo: p.rotulo, total: porCat.total, fatias: porCat.fatias };
  });
  const teto = Math.max(...serie.map((s) => s.total), 1);

  return el(
    "section",
    { class: "cartao" },
    el("h2", { class: "cartao__titulo" }, "Para onde vai"),

    el("div", { class: "fin__legenda" },
      ...fatias.map((f) =>
        el("div", { class: "fin__legenda-item" },
          el("span", { class: "fin__ponto", style: { background: cores.get(f.id) || "var(--cat-4)" } }),
          el("span", { class: "fin__legenda-nome" }, f.nome),
          el("strong", {}, `R$ ${M.formatarReais(f.valor, { comCentavos: false })}`),
          el("small", {}, `${Math.round(f.fatia * 100)}%`),
        )
      ),
    ),

    el("div", { class: "fin__serie" },
      ...serie.map((s) =>
        el("div", { class: "fin__coluna" },
          el("div", { class: "fin__pilha", title: `${s.rotulo}: R$ ${M.formatarReais(s.total)}` },
            ...s.fatias.map((f) =>
              el("div", {
                class: "fin__fatia",
                style: {
                  height: `${(f.valor / teto) * 100}%`,
                  background: cores.get(f.id) || "var(--cat-4)",
                },
              })
            ),
          ),
          el("span", { class: "fin__coluna-rotulo" }, s.rotulo.split("–")[0]),
        )
      ),
    ),
  );
}

/* ------------------------------------------------------- conciliação */

/**
 * O que a plataforma pagou contra o que o app registrou.
 *
 * Sem "diferença aceitável": o app mostra o número e quem julga é ele. Um corte
 * de "ok até 2%" ensinaria a ignorar diferença pequena e sistemática, que é
 * justamente a que mais custa ao longo dos meses.
 */
function cartaoConciliacao(periodo, f) {
  const guardado = (cfg("conciliacoes") || {})[periodo.chave];
  const c = guardado != null ? F.conciliacao({ registrado: f.bruto, informado: guardado }) : null;

  return el(
    "section",
    { class: "cartao" },
    el("h2", { class: "cartao__titulo" }, "Bate com o extrato?"),
    el("p", { class: "cartao__nota" },
      `O app registrou R$ ${M.formatarReais(f.bruto)} de bruto em ${periodo.rotulo}.`),

    c
      ? el("div", { class: "fin__conta" },
          linhaConta("A plataforma pagou", c.informado, {}),
          linhaConta("Diferença", c.diferenca, {
            forte: true,
            destaque: true,
            nota: c.pct == null ? "" : `${c.diferenca >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%`,
            alerta: !c.aFavor,
          }),
        )
      : null,

    el("button", {
      type: "button",
      class: "botao fin__acao",
      onClick: () => informarExtrato(periodo),
    }, c ? "Corrigir o extrato" : "Informar o extrato"),
  );
}

async function informarExtrato(periodo) {
  const atual = (cfg("conciliacoes") || {})[periodo.chave];
  const valor = await pedirNumero({
    titulo: `Extrato de ${periodo.rotulo}`,
    valorInicial: atual ?? null,
    ajuda: "O bruto que a plataforma diz ter pago neste período.",
  });
  if (valor == null) return;

  await salvarConfig("conciliacoes", { ...(cfg("conciliacoes") || {}), [periodo.chave]: valor });
  vibrar(20);
  document.dispatchEvent(new CustomEvent("copiloto:financeiro"));
}

/* ------------------------------------------------------------- janela */

function seletorDeJanela(repintar) {
  const botao = (id, nome) =>
    el("button", {
      type: "button",
      class: `chip ${janelaAtual === id ? "chip--ativo" : ""}`.trim(),
      onClick: () => {
        if (janelaAtual === id) return;
        janelaAtual = id;
        vibrar(8);
        repintar();
      },
    }, nome);

  return el("div", { class: "fin__janelas" }, botao("semana", "Semana"), botao("mes", "Mês"));
}
