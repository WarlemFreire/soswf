// tela-config.js — todos os numeros do "cerebro" ficam editaveis aqui.

import { el, limpar, abrirFolha } from "./ui.js";
import * as M from "./metrics.js";
import {
  cfg, configAtual, salvarConfig, restaurarPadroes,
  PERIODOS, PLATAFORMAS, CONFIG_PADRAO, custoEnergiaKm, custoTotalKm,
} from "./config.js";
import * as store from "./store.js";
import { vibrar, mostrarToast } from "./feedback.js";
import { exportarJson, exportarCsvJornadas, exportarCsvRegistros, exportarCsvPausas, importarJson, apagarTudo } from "./export.js";
import { manterTelaLigada, liberarTela } from "./geo.js";

export function montarConfig(raiz) {
  limpar(raiz);

  raiz.append(
    secao("Metas do dia (bruto)", [
      numero("Mínima", "metaMinima", { passo: 10, sufixo: "R$" }),
      numero("Ideal", "metaIdeal", { passo: 10, sufixo: "R$" }),
      numero("Ótima", "metaOtima", { passo: 10, sufixo: "R$" }),
      numero("Hora limite para a meta", "horaLimiteMeta", { passo: 1, min: 0, max: 23, sufixo: "h" }),
    ]),

    secao("Faixa de R$/hora", [
      numero("Piso", "faixaHora.piso", { passo: 1, sufixo: "R$/h" }),
      numero("Ideal", "faixaHora.ideal", { passo: 1, sufixo: "R$/h" }),
      numero("Ótimo", "faixaHora.otimo", { passo: 1, sufixo: "R$/h" }),
    ]),

    secaoFaixasKm(),

    secao("Custo do carro", [
      numero("Preço do GNV", "precoGnv", { passo: 0.1, casas: 2, sufixo: "R$/m³" }),
      numero("Consumo de GNV", "kmPorM3", { passo: 0.5, casas: 1, sufixo: "km/m³" }),
      numero("Preço do etanol", "precoEtanol", { passo: 0.1, casas: 2, sufixo: "R$/l" }),
      numero("Consumo de etanol", "kmPorLitro", { passo: 0.5, casas: 1, sufixo: "km/l" }),
      numero("% rodado no GNV", "mixGnvPct", { passo: 5, min: 0, max: 100, sufixo: "%" }),
      numero("Desgaste do carro", "custoDesgasteKm", { passo: 0.05, casas: 2, sufixo: "R$/km" }),
      resumoCusto(),
    ]),

    secao("Plataformas", [
      escolha("Principal (já vem selecionada)", "plataformaPrincipal", PLATAFORMAS.map((p) => ({ valor: p.id, nome: p.nome }))),
      ...PLATAFORMAS.map((p) =>
        interruptor(`Mostrar ${p.nome}`, null, {
          ler: () => cfg("plataformasAtivas").includes(p.id),
          gravar: async (ligado) => {
            const atuais = new Set(cfg("plataformasAtivas"));
            ligado ? atuais.add(p.id) : atuais.delete(p.id);
            await salvarConfig("plataformasAtivas", PLATAFORMAS.map((x) => x.id).filter((id) => atuais.has(id)));
          },
        })
      ),
    ]),

    secao("No carro", [
      interruptor("Usar GPS para medir km", "usarGps"),
      interruptor("Manter a tela ligada", "manterTelaLigada", {
        aoMudar: (ligado) => (ligado ? manterTelaLigada() : liberarTela()),
      }),
      interruptor("Vibrar ao registrar", "vibrar"),
      interruptor("Ler resultados em voz alta", "tts"),
      interruptor("Modo dirigindo", "modoDirigindo"),
      escolha("Tema", "tema", [
        { valor: "auto", nome: "Automático" },
        { valor: "escuro", nome: "Sempre escuro" },
        { valor: "claro", nome: "Sempre claro" },
      ]),
      numero("Escurecer a partir de", "horaModoNoturno", { passo: 1, min: 0, max: 23, sufixo: "h" }),
      numero("Avisar pausa longa após", "alertaPausaMin", { passo: 5, sufixo: "min" }),
    ]),

    secaoDados()
  );
}

/* ------------------------------------------------------------ componentes */

function secao(titulo, filhos) {
  return el("section", { class: "config__secao" }, el("h2", { class: "secao__titulo" }, titulo), ...filhos.filter(Boolean));
}

function lerCaminho(caminho) {
  const [raiz, folha] = caminho.split(".");
  return folha ? cfg(raiz)[folha] : cfg(raiz);
}

async function gravarCaminho(caminho, valor) {
  const [raiz, folha] = caminho.split(".");
  if (!folha) return salvarConfig(raiz, valor);
  return salvarConfig(raiz, { ...cfg(raiz), [folha]: valor });
}

/** Campo numerico com stepper — sem teclado do sistema, alvos grandes. */
function numero(rotulo, caminho, { passo = 1, casas = 0, min = 0, max = Infinity, sufixo = "" } = {}) {
  const valorEl = el("span", { class: "campo__valor" }, "");

  const pintar = () => {
    const v = lerCaminho(caminho);
    valorEl.textContent = `${Number(v).toFixed(casas).replace(".", ",")}${sufixo ? " " + sufixo : ""}`;
  };

  const ajustar = async (direcao) => {
    const atual = Number(lerCaminho(caminho));
    const bruto = atual + direcao * passo;
    const novo = Math.min(max, Math.max(min, Number(bruto.toFixed(4))));
    await gravarCaminho(caminho, novo);
    pintar();
    vibrar(8);
    store.notificar();
  };

  pintar();
  return el(
    "div",
    { class: "campo" },
    el("span", { class: "campo__rotulo" }, rotulo),
    el(
      "div",
      { class: "campo__stepper" },
      el("button", { type: "button", class: "stepper", onClick: () => ajustar(-1), "aria-label": `Diminuir ${rotulo}` }, "−"),
      valorEl,
      el("button", { type: "button", class: "stepper", onClick: () => ajustar(1), "aria-label": `Aumentar ${rotulo}` }, "+")
    )
  );
}

function interruptor(rotulo, chave, { ler, gravar, aoMudar } = {}) {
  const lerValor = ler || (() => !!cfg(chave));
  const gravarValor = gravar || ((v) => salvarConfig(chave, v));

  const botao = el("button", { type: "button", class: "interruptor", role: "switch" });
  const pintar = () => {
    const ligado = lerValor();
    botao.setAttribute("aria-checked", String(ligado));
    botao.classList.toggle("interruptor--ligado", ligado);
    botao.textContent = ligado ? "SIM" : "NÃO";
  };
  botao.addEventListener("click", async () => {
    const novo = !lerValor();
    await gravarValor(novo);
    pintar();
    vibrar(8);
    aoMudar?.(novo);
    store.notificar();
  });
  pintar();

  return el("div", { class: "campo" }, el("span", { class: "campo__rotulo" }, rotulo), botao);
}

function escolha(rotulo, chave, opcoes) {
  const linha = el("div", { class: "campo__opcoes" });
  for (const opcao of opcoes) {
    const botao = el(
      "button",
      {
        type: "button",
        class: `chip ${cfg(chave) === opcao.valor ? "chip--ativo" : ""}`.trim(),
        onClick: async () => {
          await salvarConfig(chave, opcao.valor);
          for (const irmao of linha.children) irmao.classList.remove("chip--ativo");
          botao.classList.add("chip--ativo");
          vibrar(8);
          store.notificar();
          document.dispatchEvent(new CustomEvent("copiloto:tema"));
        },
      },
      opcao.nome
    );
    linha.append(botao);
  }
  return el("div", { class: "campo campo--coluna" }, el("span", { class: "campo__rotulo" }, rotulo), linha);
}

function secaoFaixasKm() {
  const corpo = el("div", { class: "faixas" });
  const pintar = () => {
    limpar(corpo);
    for (const periodo of PERIODOS) {
      const faixa = cfg("faixasKm")[periodo.id];
      corpo.append(
        el(
          "button",
          {
            type: "button",
            class: "faixa",
            onClick: () => editarFaixa(periodo, pintar),
          },
          el("span", { class: "faixa__nome" }, `${periodo.nome} ${periodo.inicio}h–${periodo.fim}h`),
          el(
            "span",
            { class: "faixa__valores" },
            `${faixa.piso.toFixed(2).replace(".", ",")} · ${faixa.ideal.toFixed(2).replace(".", ",")} · ${faixa.otimo.toFixed(2).replace(".", ",")}`
          )
        )
      );
    }
  };
  pintar();

  return el(
    "section",
    { class: "config__secao" },
    el("h2", { class: "secao__titulo" }, "Faixas de R$/km por período"),
    el(
      "p",
      { class: "folha__ajuda" },
      "Estes valores são do rendimento da JORNADA (contando km vazio), não da corrida ofertada. " +
        "Toque num período para ajustar piso · ideal · ótimo."
    ),
    corpo
  );
}

function editarFaixa(periodo, aoSalvar) {
  const faixa = { ...cfg("faixasKm")[periodo.id] };
  const campos = ["piso", "ideal", "otimo"].map((chave) => {
    const valorEl = el("span", { class: "campo__valor" }, "");
    const pintar = () => (valorEl.textContent = faixa[chave].toFixed(2).replace(".", ","));
    const ajustar = (dir) => {
      faixa[chave] = Math.max(0, Number((faixa[chave] + dir * 0.05).toFixed(2)));
      pintar();
      vibrar(8);
    };
    pintar();
    return el(
      "div",
      { class: "campo" },
      el("span", { class: "campo__rotulo" }, chave === "otimo" ? "Ótimo" : chave[0].toUpperCase() + chave.slice(1)),
      el(
        "div",
        { class: "campo__stepper" },
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(-1) }, "−"),
        valorEl,
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(1) }, "+")
      )
    );
  });

  let folha;
  folha = abrirFolha({
    titulo: `${periodo.nome} · ${periodo.inicio}h–${periodo.fim}h`,
    conteudo: [
      ...campos,
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            await salvarConfig("faixasKm", { ...cfg("faixasKm"), [periodo.id]: faixa });
            aoSalvar();
            store.notificar();
            folha.fechar();
          },
        },
        "SALVAR"
      ),
    ],
  });
}

function resumoCusto() {
  const caixa = el("div", { class: "custo-resumo" });
  const pintar = () => {
    const c = configAtual();
    limpar(caixa);
    caixa.append(
      el("div", {}, `Energia: R$ ${M.formatarReais(custoEnergiaKm(c))}/km`),
      el("div", { class: "custo-resumo__total" }, `Break-even: R$ ${M.formatarReais(custoTotalKm(c))}/km`),
      el("div", { class: "custo-resumo__nota" }, `Num dia de 200 km: R$ ${M.formatarReais(custoTotalKm(c) * 200, { comCentavos: false })} de custo`)
    );
  };
  pintar();
  store.assinar(pintar);
  return caixa;
}

/* -------------------------------------------------------------- dados */

function secaoDados() {
  const arquivo = el("input", { type: "file", accept: ".json,application/json", class: "oculto" });
  arquivo.addEventListener("change", async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    try {
      const contagem = await importarJson(await f.text(), { modo: "mesclar" });
      const total = Object.values(contagem).reduce((s, n) => s + n, 0);
      await store.carregarJornadaAberta();
      mostrarToast({ titulo: "Backup restaurado", detalhe: `${total} linhas importadas` });
    } catch (erro) {
      mostrarToast({ titulo: "Não deu para importar", detalhe: erro.message, tom: "alerta" });
    }
    arquivo.value = "";
  });

  const acao = (rotulo, fn, classe = "botao--secundario") =>
    el(
      "button",
      {
        type: "button",
        class: `botao ${classe}`,
        onClick: async () => {
          vibrar();
          await fn();
        },
      },
      rotulo
    );

  return el(
    "section",
    { class: "config__secao" },
    el("h2", { class: "secao__titulo" }, "Backup e dados"),
    el(
      "p",
      { class: "folha__ajuda" },
      "Tudo fica só neste aparelho. Exporte de tempos em tempos — se o celular sumir, os dados vão junto."
    ),
    el(
      "div",
      { class: "config__botoes" },
      acao("Backup completo (JSON)", exportarJson, "botao--primario"),
      acao("CSV dos dias", exportarCsvJornadas),
      acao("CSV dos registros", exportarCsvRegistros),
      acao("CSV das pausas", exportarCsvPausas),
      acao("Restaurar backup", () => arquivo.click())
    ),
    arquivo,
    el(
      "div",
      { class: "config__botoes config__botoes--perigo" },
      acao("Restaurar padrões de fábrica", async () => {
        await restaurarPadroes();
        montarConfig(document.getElementById("tela-config"));
        mostrarToast({ titulo: "Configurações voltaram ao padrão" });
      }, "botao--texto"),
      acao("Apagar todos os dados", confirmarApagar, "botao--texto botao--perigo")
    ),
    el("p", { class: "versao" }, `Copiloto · Fase 1 · padrões calibrados em ${M.formatarReais(CONFIG_PADRAO.precoGnv)}/m³`)
  );
}

function confirmarApagar() {
  let folha;
  folha = abrirFolha({
    titulo: "Apagar tudo?",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "Isto apaga jornadas, registros e pausas deste aparelho. Não tem desfazer. Exporte um backup antes."),
      el(
        "div",
        { class: "acoes acoes--coluna" },
        el("button", { type: "button", class: "botao botao--secundario botao--gigante", onClick: () => folha.fechar() }, "Cancelar"),
        el(
          "button",
          {
            type: "button",
            class: "botao botao--perigo botao--gigante",
            onClick: async () => {
              await apagarTudo();
              await store.carregarJornadaAberta();
              folha.fechar();
              mostrarToast({ titulo: "Tudo apagado", tom: "alerta" });
            },
          },
          "Apagar mesmo assim"
        )
      ),
    ],
  });
}
