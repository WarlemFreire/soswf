// tela-config.js — todos os numeros do "cerebro" ficam editaveis aqui.

import { el, limpar, abrirFolha, chips } from "./ui.js";
import * as M from "./metrics.js";
import {
  cfg, configAtual, salvarConfig, restaurarPadroes,
  PERIODOS, PLATAFORMAS, CONFIG_PADRAO, custoEnergiaKm, custoTotalKm,
} from "./config.js";
import * as store from "./store.js";
import { vibrar, mostrarToast } from "./feedback.js";
import {
  exportarJson, exportarCsvJornadas, exportarCsvRegistros, exportarCsvPausas,
  exportarCsvPlanilha, exportarCsvCorridasRico, tsvPlanilha, linhaPlanilha, copiarParaAreaDeTransferencia,
  importarJson, apagarTudo,
} from "./export.js";
import { db } from "./db.js";
import { manterTelaLigada, liberarTela } from "./geo.js";
import { abrirCusto, painelCombustivel } from "./tela-custo.js";
import * as semaforo from "./semaforo.js";
import * as risco from "./risco.js";

export function montarConfig(raiz) {
  limpar(raiz);

  raiz.append(
    secao("Metas do dia (bruto)", [
      numero("Mínima", "metaMinima", { passo: 10, sufixo: "R$" }),
      numero("Ideal", "metaIdeal", { passo: 10, sufixo: "R$" }),
      numero("Ótima", "metaOtima", { passo: 10, sufixo: "R$" }),
      numero("Hora limite para a meta", "horaLimiteMeta", { passo: 1, min: 0, max: 23, sufixo: "h" }),
      numero("Janela do bloco", "blocoMin", { passo: 15, min: 30, max: 300, sufixo: "min" }),
      el(
        "p",
        { class: "folha__ajuda" },
        "O bloco mostra como está indo o pedaço recente da jornada, sem o peso das horas fracas " +
          "do começo do dia. Abaixo de 2h a janela costuma ficar magra demais para significar algo."
      ),
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

    secao("Abastecimento", [
      el(
        "p",
        { class: "folha__ajuda" },
        "Os valores acima são semente. A partir do segundo abastecimento com odômetro, " +
          "o custo por km passa a ser medido de bomba a bomba — e o histórico inteiro é recalculado."
      ),
      painelCombustivel(),
      el(
        "button",
        { type: "button", class: "botao botao--primario", onClick: () => abrirCusto() },
        "Registrar abastecimento ou gasto",
      ),
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

    secaoSemaforo(),

    secao("No carro", [
      interruptor("Marcar a zona no registro (GPS)", "marcarPosicao"),
      interruptor("Medir o km por GPS", "rastrearKm", {
        aoMudar: (ligado) => (ligado ? store.ligarRastreio() : store.desligarRastreio()),
      }),
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

/**
 * O semáforo de ofertas. Seção própria porque depende de duas permissões que só
 * o usuário concede, na tela do Android — e porque cada uma, faltando, deixa o
 * recurso mudo de um jeito diferente. Dizer qual está faltando é a diferença
 * entre "não funciona" e "falta um toque aqui".
 */
function secaoSemaforo() {
  const caixa = el("div", { class: "config__secao" });

  const pintar = async () => {
    const e = await semaforo.estado();
    const cortes = semaforo.cortesAgora();

    const filhos = [el("h2", { class: "secao__titulo" }, "Semáforo de ofertas")];

    if (!e.suportado) {
      // A lista de áreas continua aqui de propósito: ela é dado dele, e vale
      // cadastrar no navegador para já chegar pronta quando abrir o aplicativo.
      filhos.push(
        el("p", { class: "campo__ajuda" },
          "O semáforo só funciona no aplicativo instalado: o navegador não pode " +
          "ler a tela de outro aplicativo. As áreas abaixo já podem ser marcadas."
        ),
        listaDeAreas(() => pintar())
      );
      caixa.replaceChildren(...filhos);
      return;
    }

    filhos.push(
      el("p", { class: "campo__ajuda" },
        "Lê o valor, o km e o tempo da oferta na tela da plataforma e mostra na hora " +
        "se ela paga acima do seu piso. O texto lido não é gravado nem enviado para " +
        "nenhum lugar."
      ),
      interruptor("Ligado", "semaforoLigado", {
        ler: () => !!cfg("semaforoLigado"),
        gravar: async (v) => {
          await salvarConfig("semaforoLigado", v);
          await semaforo.ligar(v);
        },
        aoMudar: () => pintar(),
      })
    );

    // Cada pendência é uma linha com o botão que resolve ela.
    if (!e.acessibilidadeAtiva) {
      filhos.push(
        pendencia(
          "Falta autorizar a leitura de tela",
          "Abrir acessibilidade",
          () => semaforo.abrirAcessibilidade()
        )
      );
    }
    if (!e.podeSobrepor) {
      filhos.push(
        pendencia(
          "Falta autorizar desenhar sobre outros aplicativos",
          "Abrir permissão",
          () => semaforo.abrirSobreposicao()
        )
      );
    }
    if (!cortes) {
      filhos.push(
        el("p", { class: "campo__ajuda" },
          "Ainda sem histórico suficiente nesta faixa horária. Até ter, o selo não " +
          "aparece — melhor calado do que com cor chutada."
        )
      );
    } else {
      filhos.push(
        el("p", { class: "campo__ajuda" },
          `Agora (${cortes.periodo}): recusar abaixo de ${cortes.pisoHora.toFixed(0)} R$/h. ` +
          `Boa a partir de ${cortes.idealHora.toFixed(0)}, ótima de ${cortes.otimoHora.toFixed(0)}. ` +
          `Prejuízo abaixo de ${cortes.custoKm.toFixed(2).replace(".", ",")} R$/km.`
        )
      );
    }

    filhos.push(listaDeAreas(() => pintar()));

    caixa.replaceChildren(...filhos);
  };

  pintar();
  // Voltar da tela do Android tem que atualizar o que está pendente.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pintar();
  });
  return caixa;
}

/**
 * As áreas que ele não quer pegar.
 *
 * Casadas por NOME contra o texto da oferta, não por raio no mapa: no instante
 * da oferta o app sabe onde ELE está, não para onde a corrida vai — o destino
 * só existe como texto na tela. Ver risco.js.
 */
function listaDeAreas(repintar) {
  const areas = cfg("areasRisco") || [];

  return el(
    "div",
    { class: "areas" },
    el("h3", { class: "areas__titulo" }, "Áreas que eu não pego"),
    areas.length
      ? el("div", { class: "areas__lista" },
          ...areas.map((a) =>
            el("button", {
              type: "button",
              class: `areas__item ${a.ativa === false ? "areas__item--off" : ""}`.trim(),
              onClick: () => editarArea(a, repintar),
            },
              el("span", { class: `areas__selo areas__selo--${a.nivel}` },
                a.nivel === "evitar" ? "não pegar" : "atenção"),
              el("span", { class: "areas__nome" }, a.nome),
              el("small", { class: "areas__termos" }, (a.termos || []).join(" · ")),
            )
          ),
        )
      : el("p", { class: "campo__ajuda" },
          "Nenhuma área marcada. O semáforo avisa quando o nome de uma delas " +
          "aparecer na oferta."),
    el("button", {
      type: "button",
      class: "botao fin__acao",
      onClick: () => editarArea(null, repintar),
    }, "Marcar uma área"),
  );
}

async function editarArea(area, repintar) {
  const nome = el("input", {
    class: "campo-texto",
    type: "text",
    value: area?.nome || "",
    placeholder: "Como você chama a área",
    maxLength: 40,
  });
  const termos = el("input", {
    class: "campo-texto",
    type: "text",
    value: (area?.termos || []).join(", "),
    placeholder: "Morro do Papagaio, Alto Vera Cruz",
  });

  let nivel = area?.nivel || "atencao";
  const escolhaNivel = chips(risco.NIVEIS.map((n) => ({ id: n.id, nome: n.nome })), {
    selecionado: nivel,
    aoEscolher: (id) => {
      nivel = id;
    },
  });

  abrirFolha({
    titulo: area ? "Editar área" : "Marcar área",
    classe: "folha--alta",
    conteudo: [
      el("label", { class: "perfil__rotulo" }, "Nome"),
      nome,
      el("label", { class: "perfil__rotulo" }, "Nomes que aparecem na oferta"),
      termos,
      el("p", { class: "folha__ajuda" },
        "Separe por vírgula. O aviso só dispara com a palavra inteira, então " +
        "\"Ana\" não casa dentro de \"Cabana\". Termos de menos de três letras " +
        "são ignorados, porque casariam com meia cidade."),
      escolhaNivel,
      el("p", { class: "folha__ajuda" },
        "\"Não pegar\" recusa mesmo com o valor bom. \"Atenção\" só avisa."),
    ],
    rodape: (folha) => [
      area
        ? el("button", {
            type: "button",
            class: "botao botao--perigo",
            onClick: async () => {
              await salvarConfig("areasRisco", (cfg("areasRisco") || []).filter((x) => x.id !== area.id));
              await semaforo.sincronizarAreas();
              folha.fechar();
              repintar();
            },
          }, "Apagar")
        : null,
      el("button", {
        type: "button",
        class: "botao botao--primario botao--gigante",
        onClick: async () => {
          const limpa = risco.normalizarArea({
            id: area?.id,
            nome: nome.value,
            nivel,
            termos: termos.value.split(","),
          });
          if (!limpa.termos.length) {
            mostrarToast({ titulo: "Falta um nome com três letras ou mais", tom: "alerta" });
            return;
          }
          const atuais = (cfg("areasRisco") || []).filter((x) => x.id !== limpa.id);
          await salvarConfig("areasRisco", [...atuais, limpa]);
          await semaforo.sincronizarAreas();
          vibrar(20);
          folha.fechar();
          repintar();
        },
      }, "Salvar"),
    ].filter(Boolean),
  });
}

function pendencia(texto, rotuloBotao, acao) {
  return el(
    "div",
    { class: "campo" },
    el("span", { class: "campo__rotulo campo__rotulo--alerta" }, texto),
    el("button", { type: "button", class: "botao", onClick: acao }, rotuloBotao)
  );
}

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
    const medido = store.energiaKm();
    const energia = medido > 0 ? medido : custoEnergiaKm(c);
    const total = energia + (c.custoDesgasteKm || 0);
    limpar(caixa);
    caixa.append(
      el("div", {}, `Energia: R$ ${M.formatarReais(energia)}/km ${medido > 0 ? "(medido)" : "(semente)"}`),
      el("div", { class: "custo-resumo__total" }, `Break-even: R$ ${M.formatarReais(total)}/km`),
      el("div", { class: "custo-resumo__nota" }, `Num dia de 200 km: R$ ${M.formatarReais(total * 200, { comCentavos: false })} de custo`)
    );
  };
  pintar();
  store.assinar(pintar);
  return caixa;
}

/**
 * Prévia da primeira linha que sera colada. Colar numero como texto zera as
 * formulas da planilha sem avisar; ver a linha antes evita a surpresa.
 */
function previaPlanilha() {
  const caixa = el("pre", { class: "previa" });
  const pintar = async () => {
    const corridas = (await db.todos("corridas")).sort((a, b) => b.timestamp - a.timestamp);
    caixa.textContent = corridas.length
      ? linhaPlanilha(corridas[0]).join("  |  ")
      : "Sem corridas registradas — nada para pré-visualizar.";
  };
  pintar();
  store.assinar(pintar);
  document.addEventListener("copiloto:tema", pintar);
  return el("div", {}, el("p", { class: "folha__ajuda" }, "Prévia da linha mais recente:"), caixa);
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
    el("h2", { class: "secao__titulo" }, "Para a planilha"),
    el(
      "p",
      { class: "folha__ajuda" },
      "As colunas saem na ordem exata da aba Corridas (Data até Destino). " +
        "As colunas de fórmula da planilha não são tocadas."
    ),
    escolha("Separador decimal da planilha", "separadorDecimal", [
      { valor: ",", nome: "Vírgula  1.234,56" },
      { valor: ".", nome: "Ponto  1234.56" },
    ]),
    previaPlanilha(),
    el(
      "div",
      { class: "config__botoes" },
      acao("Copiar todas as corridas", async () => {
        const corridas = (await db.todos("corridas")).sort((a, b) => a.timestamp - b.timestamp);
        if (!corridas.length) {
          mostrarToast({ titulo: "Nenhuma corrida registrada ainda", tom: "alerta" });
          return;
        }
        const deu = await copiarParaAreaDeTransferencia(tsvPlanilha(corridas));
        mostrarToast({
          titulo: deu ? `${corridas.length} corridas copiadas` : "Não deu para copiar",
          detalhe: deu ? "Cole na primeira linha vazia da aba Corridas." : "Use o CSV abaixo.",
          tom: deu ? "ok" : "alerta",
          duracao: 6000,
        });
      }, "botao--primario"),
      acao("CSV no formato da planilha", async () => {
        const corridas = (await db.todos("corridas")).sort((a, b) => a.timestamp - b.timestamp);
        await exportarCsvPlanilha(corridas);
      }),
      acao("CSV completo das corridas", exportarCsvCorridasRico)
    ),

    el("h2", { class: "secao__titulo secao__titulo--espacado" }, "Backup e dados"),
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
