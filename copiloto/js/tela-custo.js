// tela-custo.js — abastecimento e demais gastos.
//
// Este módulo é imune ao problema que derrubou a medição por GPS: consumo se
// mede de bomba a bomba, com o odômetro digitado no posto. Não depende de
// rastreamento contínuo nenhum.

import { el, limpar, abrirFolha, chips, trocar } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { vibrar, falar, mostrarToast } from "./feedback.js";
import { db } from "./db.js";

const TIPOS = [
  { id: "gnv", nome: "GNV", unidade: "m³", combustivel: true },
  { id: "gasolina", nome: "Gasolina", unidade: "litros", combustivel: true },
  { id: "etanol", nome: "Etanol", unidade: "litros", combustivel: true },
  { id: "pedagio", nome: "Pedágio" },
  { id: "alimentacao", nome: "Alimentação" },
  { id: "lavagem", nome: "Lavagem" },
  { id: "manutencao", nome: "Manutenção" },
  { id: "outro", nome: "Outro" },
];

export function abrirCusto({ tipoInicial = "gnv" } = {}) {
  vibrar();

  let tipo = tipoInicial;
  let campo = "valor";
  const valores = { valor: null, litros: null, odometro: null };

  const teclados = {
    valor: new Teclado({ modo: "dinheiro", aoMudar: aoDigitar }),
    litros: new Teclado({ modo: "dinheiro", aoMudar: aoDigitar }),
    odometro: new Teclado({ modo: "inteiro", aoMudar: aoDigitar }),
  };

  const visor = el("div", { class: "visor" }, "0");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "corrida__teclado" });
  const resumo = el("div", { class: "custo__resumo" });

  const linhaCampos = el("div", { class: "chips chips--alvos" });
  const salvar = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", disabled: true, onClick: gravar },
    "SALVAR"
  );

  const folha = abrirFolha({
    titulo: "Custo",
    classe: "folha--alta",
    conteudo: [
      chips(TIPOS, {
        selecionado: tipo,
        classe: "chips--tipos",
        aoEscolher: (id) => {
          tipo = id;
          montarCampos();
          selecionarCampo("valor");
        },
      }),
      linhaCampos,
      visor,
      legenda,
      caixaTeclado,
      resumo,
    ],
    rodape: [salvar],
  });

  montarCampos();
  selecionarCampo("valor");

  function definicaoDoTipo() {
    return TIPOS.find((t) => t.id === tipo) || TIPOS[0];
  }

  function camposDoTipo() {
    const def = definicaoDoTipo();
    // Litros e odômetro só fazem sentido em combustível — são eles que
    // permitem medir consumo e custo por km.
    return def.combustivel
      ? [
          { id: "valor", nome: "Valor" },
          { id: "litros", nome: def.unidade === "m³" ? "m³" : "Litros" },
          { id: "odometro", nome: "Odômetro" },
        ]
      : [{ id: "valor", nome: "Valor" }];
  }

  function montarCampos() {
    limpar(linhaCampos);
    for (const c of camposDoTipo()) {
      const botao = el(
        "button",
        {
          type: "button",
          class: `chip ${c.id === campo ? "chip--ativo" : ""}`.trim(),
          dataset: { id: c.id },
          onClick: () => selecionarCampo(c.id),
        },
        c.nome
      );
      linhaCampos.append(botao);
    }
    linhaCampos.classList.toggle("oculto", camposDoTipo().length < 2);
  }

  function selecionarCampo(id) {
    valores[campo] = teclados[campo].valor;
    campo = id;
    trocar(caixaTeclado, teclados[id].el);
    teclados[id].definir(valores[id] ?? null);
    for (const botao of linhaCampos.children) botao.classList.toggle("chip--ativo", botao.dataset.id === id);
    atualizar();
  }

  function aoDigitar() {
    valores[campo] = teclados[campo].valor;
    atualizar();
  }

  function atualizar() {
    const def = definicaoDoTipo();
    visor.textContent = teclados[campo].exibicao;
    visor.classList.toggle("visor--odometro", campo === "odometro");

    legenda.textContent =
      campo === "valor"
        ? `Quanto pagou de ${def.nome.toLowerCase()}`
        : campo === "litros"
          ? `Quantos ${def.unidade} entraram`
          : "Odômetro do painel no posto — é ele que mede o consumo";

    salvar.disabled = !(valores.valor > 0);
    pintarResumo();
  }

  function pintarResumo() {
    limpar(resumo);
    const def = definicaoDoTipo();
    if (!def.combustivel) return;

    const analise = store.analiseCombustivel();
    const linhas = [];

    if (valores.valor > 0 && valores.litros > 0) {
      linhas.push(`R$ ${M.formatarReais(valores.valor / valores.litros)} por ${def.unidade}`);
    }

    const anterior = ultimoAbastecimento();
    if (anterior && valores.odometro > anterior.odometro && valores.litros > 0) {
      const km = valores.odometro - anterior.odometro;
      linhas.push(`${km} km desde o último · ${(km / valores.litros).toFixed(1).replace(".", ",")} km/${def.unidade}`);
      linhas.push(`R$ ${M.formatarReais(valores.valor / km)} por km neste tanque`);
    } else if (!anterior) {
      linhas.push("Primeiro abastecimento registrado — o consumo aparece no próximo.");
    }

    if (analise.suficiente) {
      linhas.push(
        `Média atual: R$ ${M.formatarReais(analise.porKm)}/km em ${analise.kmPeriodo} km medidos`
      );
    }

    for (const texto of linhas) resumo.append(el("div", { class: "custo__resumo-linha" }, texto));
  }

  async function gravar() {
    valores[campo] = teclados[campo].valor;
    if (!(valores.valor > 0)) return;

    const def = definicaoDoTipo();
    await store.registrarCusto({
      tipo,
      valor: valores.valor,
      litros: def.combustivel ? valores.litros : null,
      odometro: def.combustivel ? valores.odometro : null,
    });

    folha.fechar();
    const analise = store.analiseCombustivel();
    vibrar(40);
    mostrarToast({
      titulo: `−R$ ${M.formatarReais(valores.valor, { comCentavos: false })}`,
      detalhe: analise.suficiente
        ? `custo de energia agora: R$ ${M.formatarReais(analise.porKm)}/km (medido)`
        : "registrado · o custo por km sai no próximo abastecimento",
    });
    falar(`${def.nome}, ${Math.round(valores.valor)} reais.`);
  }
}

function ultimoAbastecimento() {
  return store.ultimoAbastecimento();
}

/* ------------------------------------------------------------- resumo */

/** Painel de consumo mostrado nos Ajustes. */
/**
 * Os últimos lançamentos, com apagar.
 *
 * Existe porque não existia: `removerCusto` estava no store.js desde sempre e
 * NENHUMA tela chamava. Um valor digitado errado ficava para sempre, e como o
 * custo por km sai dos abastecimentos reais, um zero a mais contaminava o
 * líquido, o break-even e o piso do semáforo de uma vez.
 *
 * Apagar e relançar em vez de editar: são dois toques, o teclado de lançar já
 * existe e está testado, e uma tela de edição seria uma segunda forma de
 * escrever a mesma coisa -- mais lugar para divergir.
 */
export function listaDeCustos(quantos = 8) {
  const caixa = el("div", { class: "custos" });

  const pintar = async () => {
    const todos = await db.todos("custos");
    const recentes = todos.sort((a, b) => b.timestamp - a.timestamp).slice(0, quantos);

    if (!recentes.length) {
      trocar(caixa, el("p", { class: "campo__ajuda" }, "Nenhum custo lançado ainda."));
      return;
    }

    trocar(caixa, 
      el("h3", { class: "areas__titulo" }, "Últimos lançamentos"),
      ...recentes.map((c) => {
        const tipo = TIPOS.find((t) => t.id === c.tipo);
        return el("div", { class: "custos__item" },
          el("div", { class: "custos__texto" },
            el("strong", {}, `R$ ${M.formatarReais(c.valor)}`),
            el("small", {},
              `${tipo?.nome || c.tipo} · ${M.formatarData(c.timestamp)}` +
              (c.litros > 0 ? ` · ${c.litros} ${tipo?.unidade || ""}`.trimEnd() : "") +
              (c.odometro > 0 ? ` · ${c.odometro} km` : ""))),
          el("button", {
            type: "button",
            class: "custos__apagar",
            "aria-label": `Apagar ${tipo?.nome || c.tipo} de R$ ${M.formatarReais(c.valor)}`,
            onClick: async () => {
              await store.removerCusto(c.id);
              vibrar(20);
              mostrarToast({
                titulo: "Lançamento apagado",
                detalhe: "O custo por km e o líquido já foram recalculados.",
              });
              pintar();
            },
          }, "Apagar")
        );
      })
    );
  };

  pintar();
  document.addEventListener("copiloto:custo", pintar);
  return caixa;
}

export function painelCombustivel() {
  const caixa = el("div", { class: "custo-resumo" });

  const pintar = () => {
    const analise = store.analiseCombustivel();
    limpar(caixa);

    if (!analise.suficiente) {
      caixa.append(
        el(
          "div",
          { class: "custo-resumo__nota" },
          analise.abastecimentos === 0
            ? "Nenhum abastecimento registrado. Com dois, o custo por km deixa de ser estimativa."
            : "Um abastecimento registrado. Falta o próximo para fechar a primeira medição."
        )
      );
      return;
    }

    caixa.append(
      el("div", { class: "custo-resumo__total" }, `R$ ${M.formatarReais(analise.porKm)}/km de energia`),
      el(
        "div",
        { class: "custo-resumo__nota" },
        `medido em ${analise.kmPeriodo} km e ${analise.abastecimentos} abastecimentos ` +
          `(R$ ${M.formatarReais(analise.gasto)})`
      )
    );

    const consumos = Object.entries(analise.consumos);
    if (consumos.length) {
      for (const [tipo, dados] of consumos) {
        const unidade = tipo === "gnv" ? "m³" : "l";
        caixa.append(
          el(
            "div",
            { class: "custo-resumo__nota" },
            `${tipo}: ${dados.media.toFixed(1).replace(".", ",")} km/${unidade} ` +
              `(${dados.amostras} tanque${dados.amostras > 1 ? "s" : ""})`
          )
        );
      }
    } else {
      caixa.append(
        el(
          "div",
          { class: "custo-resumo__nota" },
          "Consumo por combustível ainda sem medida: ele só sai quando dois abastecimentos " +
            "seguidos são do mesmo tipo. Num carro que alterna gás e líquido no meio do trajeto, " +
            "o custo por km acima é o número confiável."
        )
      );
    }
  };

  pintar();
  store.assinar(pintar);
  return caixa;
}
