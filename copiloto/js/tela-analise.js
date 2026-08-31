// tela-analise.js — os dashboards, calculados no aparelho.
//
// Cada bloco diz de onde veio o número, porque as duas fontes têm precisões
// diferentes e misturá-las silenciosamente já causou estrago antes.

import { el, limpar } from "./ui.js";
import * as M from "./metrics.js";
import * as A from "./analise.js";
import * as store from "./store.js";
import { db } from "./db.js";
import { configAtual, MOTIVOS_PAUSA } from "./config.js";

export async function montarAnalise(raiz) {
  limpar(raiz);

  const resumos = await store.historico();
  const dias = store.agruparPorDia(resumos.filter((r) => r.jornada.status === "fechada"));
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const corridas = await db.todos("corridas");
  const custos = await db.todos("custos");

  if (!dias.length && !corridas.length) {
    raiz.append(
      el(
        "div",
        { class: "vazio" },
        el("p", { class: "vazio__texto" }, "Sem dados ainda."),
        el("p", { class: "vazio__dica" }, "Feche uma jornada e a análise começa a aparecer aqui.")
      )
    );
    return;
  }

  raiz.append(blocoResumo(dias, corridas, custos));
  if (dias.length) raiz.append(blocoDiaDaSemana(dias));
  if (dias.length) raiz.append(blocoHoraDosTrechos(jornadas, registros));
  if (dias.length) raiz.append(blocoPausas(dias));
  raiz.append(blocoCusto(custos));
  if (corridas.length) {
    raiz.append(blocoFaixaHoraria(corridas));
    raiz.append(blocoHeatmap(corridas));
    raiz.append(blocoBairros(corridas));
    raiz.append(blocoLongaCurta(corridas));
    raiz.append(blocoDinamico(corridas));
  }
}

/* ------------------------------------------------------------ estrutura */

function secao(titulo, fonte, ...filhos) {
  return el(
    "section",
    { class: "analise__secao" },
    el("h2", { class: "secao__titulo" }, titulo),
    fonte ? el("p", { class: "analise__fonte" }, fonte) : null,
    ...filhos.filter(Boolean)
  );
}

const reais = (v, casas = 0) => (v == null ? "—" : v.toFixed(casas).replace(".", ","));

/**
 * Barras horizontais. Numa tela de celular elas cabem com o rótulo legível, o
 * que barras verticais de 24 horas não conseguem.
 */
function barras(itens, { formato = (v) => reais(v), vazio = "sem dado" } = {}) {
  const valores = itens.map((i) => i.valor).filter((v) => v != null && Number.isFinite(v));
  const maximo = Math.max(0, ...valores);

  return el(
    "div",
    { class: "barras" },
    ...itens.map((item) =>
      el(
        "div",
        { class: `barra ${item.destaque ? "barra--destaque" : ""}`.trim() },
        el("span", { class: "barra__rotulo" }, item.rotulo),
        el(
          "div",
          { class: "barra__trilha" },
          item.valor != null && maximo > 0
            ? el("div", {
                class: "barra__marca",
                style: { width: `${Math.max(2, (item.valor / maximo) * 100)}%` },
              })
            : null
        ),
        el("span", { class: "barra__valor" }, item.valor == null ? vazio : formato(item.valor))
      )
    )
  );
}

/* -------------------------------------------------------------- blocos */

function blocoResumo(dias, corridas, custos) {
  const bruto = dias.reduce((s, d) => s + d.saldo, 0);

  // Numerador e denominador têm que vir do MESMO conjunto de dias. Dividir o
  // bruto de todos pelo tempo de alguns infla a taxa em silêncio — os dias
  // importados da planilha não têm hora trabalhada nem km.
  const comTempo = dias.filter((d) => d.msAtivo > 0);
  const brutoComTempo = comTempo.reduce((s, d) => s + d.saldo, 0);
  const msAtivo = comTempo.reduce((s, d) => s + d.msAtivo, 0);

  const comKm = dias.filter((d) => d.km > 0);
  const brutoComKm = comKm.reduce((s, d) => s + d.saldo, 0);
  const km = comKm.reduce((s, d) => s + d.km, 0);

  const energia = M.analiseAbastecimentos(custos);

  const tiles = [
    { rotulo: "dias", valor: String(dias.length) },
    { rotulo: "bruto", valor: `R$ ${M.formatarReais(bruto, { comCentavos: false })}` },
    {
      rotulo: "R$/hora",
      valor: msAtivo > 0 ? reais(brutoComTempo / (msAtivo / M.HORA)) : "—",
    },
    { rotulo: "corridas", valor: String(corridas.length) },
  ];
  if (km > 0) tiles.push({ rotulo: "R$/km", valor: reais(brutoComKm / km, 2) });
  if (energia.suficiente) tiles.push({ rotulo: "energia", valor: `${reais(energia.porKm, 2)}/km` });

  return secao(
    "Resumo",
    null,
    el(
      "div",
      { class: "analise__tiles" },
      ...tiles.map((t) =>
        el(
          "div",
          { class: "analise__tile" },
          el("strong", {}, t.valor),
          el("span", {}, t.rotulo)
        )
      )
    ),
    comTempo.length < dias.length
      ? el(
          "p",
          { class: "analise__nota" },
          `R$/hora sobre ${comTempo.length} de ${dias.length} dias — os importados da planilha não têm hora trabalhada.`
        )
      : null
  );
}

function blocoDiaDaSemana(dias) {
  const linhas = A.porDiaDaSemana(dias);
  const temTempo = linhas.some((l) => l.reaisPorHora != null);
  const melhor = Math.max(...linhas.map((l) => (temTempo ? l.reaisPorHora : l.brutoMedio) ?? 0));

  return secao(
    temTempo ? "R$/hora por dia da semana" : "Bruto médio por dia da semana",
    "Dos seus dias fechados no app — hora de início, fim e pausas são carimbos reais.",
    barras(
      linhas.map((l) => {
        const valor = temTempo ? l.reaisPorHora : l.brutoMedio;
        return {
          rotulo: l.nome,
          valor,
          destaque: valor != null && valor === melhor && melhor > 0,
        };
      }),
      { formato: (v) => (temTempo ? `${reais(v)} R$/h` : `R$ ${reais(v)}`), vazio: "—" }
    ),
    el(
      "p",
      { class: "analise__nota" },
      `${linhas.reduce((n, l) => n + (temTempo ? l.comTempo : l.dias), 0)} dia(s) no cálculo.`
    )
  );
}

function blocoHoraDosTrechos(jornadas, registros) {
  const horas = A.porHoraDosTrechos(jornadas, registros).filter((h) => h.ms > 0);
  if (!horas.length) return null;
  const melhor = Math.max(...horas.map((h) => h.reaisPorHora ?? 0));

  return secao(
    "R$/hora por faixa horária",
    "Dos trechos entre checkpoints. O valor é espalhado pelas horas do trecho.",
    barras(
      horas.map((h) => ({
        rotulo: `${String(h.hora).padStart(2, "0")}h`,
        valor: h.reaisPorHora,
        destaque: h.reaisPorHora === melhor && melhor > 0,
      })),
      { formato: (v) => `${reais(v)} R$/h` }
    ),
    el(
      "p",
      { class: "analise__nota analise__nota--alerta" },
      "Aproximado: o checkpoint não diz em que minuto o dinheiro entrou, então o " +
        "trecho borra as horas que cobre. Serve para tendência, não para achar a janela exata."
    )
  );
}

function blocoPausas(dias) {
  const motivos = A.porMotivoDePausa(dias);
  if (!motivos.length) return null;
  const total = motivos.reduce((s, m) => s + m.ms, 0);
  const nome = (id) => MOTIVOS_PAUSA.find((m) => m.id === id)?.nome || id;

  return secao(
    "Tempo parado, por motivo",
    "Das pausas registradas no app.",
    barras(
      motivos.map((m) => ({ rotulo: nome(m.motivo), valor: m.ms / M.HORA })),
      { formato: (v) => `${M.formatarDuracao(v * M.HORA)}` }
    ),
    el(
      "p",
      { class: "analise__nota" },
      `${M.formatarDuracao(total)} parado no total, em ${motivos.reduce((s, m) => s + m.n, 0)} pausas.`
    )
  );
}

function blocoCusto(custos) {
  const analise = M.analiseAbastecimentos(custos);
  const config = configAtual();
  const total = M.custosEstimados(1, config, analise.porKm);

  const linhas = [
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Energia"),
      el("span", { class: "resumo__valor" }, `R$ ${M.formatarReais(total.energiaKm)}/km`),
      el("span", { class: "comparacao" }, total.medido ? "medido" : "semente")
    ),
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Desgaste"),
      el("span", { class: "resumo__valor" }, `R$ ${M.formatarReais(total.desgasteKm)}/km`)
    ),
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Break-even"),
      el("span", { class: "resumo__valor" }, `R$ ${M.formatarReais(total.totalKm)}/km`)
    ),
  ];

  for (const [tipo, dados] of Object.entries(analise.consumos || {})) {
    linhas.push(
      el(
        "div",
        { class: "resumo__linha" },
        el("span", { class: "resumo__rotulo" }, `Consumo ${tipo}`),
        el("span", { class: "resumo__valor" }, `${reais(dados.media, 1)} km/${tipo === "gnv" ? "m³" : "l"}`),
        el("span", { class: "comparacao" }, `${dados.amostras} tanque${dados.amostras > 1 ? "s" : ""}`)
      )
    );
  }

  return secao(
    "Custo do carro",
    analise.suficiente
      ? `Medido em ${analise.kmPeriodo} km e ${analise.abastecimentos} abastecimentos.`
      : "Ainda pelos valores das configurações — dois abastecimentos com odômetro trocam por medição.",
    ...linhas
  );
}

function blocoFaixaHoraria(corridas) {
  const horas = A.porFaixaHoraria(corridas).filter((h) => h.n > 0);
  if (!horas.length) return null;
  const melhor = Math.max(...horas.map((h) => h.reaisPorKm ?? 0));

  return secao(
    "R$/km por hora, das corridas",
    "Da hora do recibo — preciso, mesmo quando a corrida foi lançada depois.",
    barras(
      horas.map((h) => ({
        rotulo: `${String(h.hora).padStart(2, "0")}h`,
        valor: h.reaisPorKm,
        destaque: h.reaisPorKm === melhor,
      })),
      { formato: (v) => reais(v, 2) }
    ),
    el(
      "p",
      { class: "analise__nota" },
      `${corridas.length} corridas. Este é o R$/km da corrida, não o da jornada — a jornada inclui o km vazio.`
    )
  );
}

/**
 * Heatmap 7×24. Rampa sequencial de um tom só: o passo mais claro (ou mais
 * escuro, no tema noturno) recua para perto do fundo e significa "quase nada".
 */
function blocoHeatmap(corridas) {
  const matriz = A.heatmapHoraDia(corridas);
  const valores = matriz.flat().map((c) => c.valor);
  const maximo = Math.max(...valores);
  if (!(maximo > 0)) return null;

  const detalhe = el("p", { class: "analise__nota" }, "Toque numa célula para ver o valor.");

  const grade = el(
    "div",
    { class: "heatmap" },
    el(
      "div",
      { class: "heatmap__horas" },
      el("span", { class: "heatmap__canto" }, ""),
      ...Array.from({ length: 24 }, (_, h) =>
        el("span", { class: "heatmap__hora" }, h % 3 === 0 ? String(h).padStart(2, "0") : "")
      )
    ),
    ...matriz.map((linha, dia) =>
      el(
        "div",
        { class: "heatmap__linha" },
        el("span", { class: "heatmap__dia" }, A.DIAS_SEMANA[dia]),
        ...linha.map((celula) =>
          el("button", {
            type: "button",
            class: `heatmap__celula heatmap__celula--n${nivelHeat(celula.valor, maximo)}`,
            title: `${celula.nome} ${String(celula.hora).padStart(2, "0")}h`,
            onClick: () => {
              detalhe.textContent = celula.n
                ? `${celula.nome} ${String(celula.hora).padStart(2, "0")}h · ` +
                  `R$ ${M.formatarReais(celula.valor, { comCentavos: false })} em ${celula.n} corrida${celula.n > 1 ? "s" : ""}`
                : `${celula.nome} ${String(celula.hora).padStart(2, "0")}h · nenhuma corrida`;
            },
          })
        )
      )
    )
  );

  return secao(
    "Heatmap hora × dia da semana",
    "Faturamento acumulado por célula, das corridas lançadas.",
    el("div", { class: "heatmap__rolagem" }, grade),
    detalhe
  );
}

function nivelHeat(valor, maximo) {
  if (!(valor > 0)) return 0;
  return Math.min(5, Math.max(1, Math.ceil((valor / maximo) * 5)));
}

function blocoBairros(corridas) {
  const bairros = A.porBairro(corridas, { minimo: 2 }).slice(0, 10);
  if (!bairros.length) return null;
  const melhor = Math.max(...bairros.map((b) => b.reaisPorKm ?? 0));

  return secao(
    "Bairros de origem",
    "Ordenado por faturamento; a barra mostra o R$/km de cada um.",
    barras(
      bairros.map((b) => ({
        rotulo: b.nome.length > 18 ? b.nome.slice(0, 17) + "…" : b.nome,
        valor: b.reaisPorKm,
        destaque: b.reaisPorKm === melhor,
      })),
      { formato: (v) => reais(v, 2) }
    ),
    el(
      "p",
      { class: "analise__nota" },
      bairros
        .slice(0, 3)
        .map((b) => `${b.nome}: ${b.n} corridas, R$ ${M.formatarReais(b.valor, { comCentavos: false })}`)
        .join(" · ")
    )
  );
}

function blocoLongaCurta(corridas) {
  const r = A.longaVsCurta(corridas, 5);
  if (!r.longa.n || !r.curta.n) return null;

  const linha = (g) =>
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, g.nome),
      el("span", { class: "resumo__valor" }, `${reais(g.reaisPorKm, 2)} R$/km`),
      el("span", { class: "comparacao" }, `${g.n} corridas · ticket R$ ${reais(g.ticket)}`)
    );

  return secao(
    "Corrida longa compensa?",
    "Corte em 5 km, das corridas lançadas.",
    linha(r.curta),
    linha(r.longa),
    el(
      "p",
      { class: "analise__nota analise__nota--alerta" },
      "Ressalva: o R$/h aqui conta só o tempo dentro da corrida. Não conta ir buscar o " +
        "passageiro, que pesa proporcionalmente mais nas curtas — então a vantagem delas está superestimada."
    )
  );
}

function blocoDinamico(corridas) {
  const r = A.impactoDinamico(corridas);
  if (r.fatia == null || !r.com.n) return null;

  return secao(
    "Preço dinâmico",
    "Das corridas lançadas.",
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Do seu faturamento"),
      el("span", { class: "resumo__valor" }, `${(r.fatia * 100).toFixed(0)}%`),
      el("span", { class: "comparacao" }, `R$ ${M.formatarReais(r.dinamico, { comCentavos: false })}`)
    ),
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Com dinâmico"),
      el("span", { class: "resumo__valor" }, `${reais(r.com.reaisPorKm, 2)} R$/km`),
      el("span", { class: "comparacao" }, `${r.com.n} corridas · ticket R$ ${reais(r.com.ticket)}`)
    ),
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Sem dinâmico"),
      el("span", { class: "resumo__valor" }, `${reais(r.sem.reaisPorKm, 2)} R$/km`),
      el("span", { class: "comparacao" }, `${r.sem.n} corridas · ticket R$ ${reais(r.sem.ticket)}`)
    )
  );
}
