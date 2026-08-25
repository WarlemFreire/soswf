// tela-fechamento.js — resumo do dia. A Fase 2 acrescenta custos reais de
// abastecimento; aqui o liquido ainda é estimado pelo custo por km configurado.

import { el, abrirFolha } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { configAtual } from "./config.js";
import { vibrar, falar } from "./feedback.js";

export function abrirFechamento() {
  const jornada = store.jornadaAtiva();
  if (!jornada) return;
  vibrar();

  const sugerido = store.odometroSugerido();
  const teclado = new Teclado({ modo: "inteiro", aoMudar: () => atualizar() });

  const visor = el("div", { class: "visor visor--odometro" }, "—");
  const aviso = el("p", { class: "folha__ajuda" }, "");
  const observacoes = el("textarea", {
    class: "campo-texto",
    rows: 3,
    placeholder: "O que aconteceu hoje? (opcional)",
  });

  function atualizar() {
    visor.textContent = teclado.exibicao;
    const km = (teclado.valor ?? 0) - jornada.odometroInicio;
    aviso.textContent =
      teclado.valor == null || km < 0
        ? "Digite o odômetro do painel agora."
        : `${km.toLocaleString("pt-BR")} km rodados hoje.`;
  }
  teclado.definir(sugerido);
  atualizar();

  let folha;
  folha = abrirFolha({
    titulo: "Encerrar jornada",
    classe: "folha--alta",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "Odômetro final — é ele que fecha a conta do km do dia."),
      visor,
      aviso,
      teclado.el,
      observacoes,
    ],
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            const fechada = await store.fecharJornada({
              odometroFim: teclado.valor,
              observacoes: observacoes.value.trim(),
            });
            folha.fechar();
            vibrar([40, 60, 40]);
            mostrarResumo(fechada);
          },
        },
        "FECHAR O DIA"
      ),
    ],
  });
}

export async function mostrarResumo(jornada) {
  const resumos = await store.historico();
  const atual = resumos.find((r) => r.jornada.id === jornada.id);
  if (!atual) return;

  const outros = resumos.filter((r) => r.jornada.id !== jornada.id);
  const config = configAtual();
  const custos = M.custosEstimados(atual.km, config);

  const comparar = (campo, valor, casas = 2) => {
    const m7 = store.media(outros, 7, campo);
    const m30 = store.media(outros, 30, campo);
    if (m7 == null && m30 == null) return el("span", { class: "comparacao" }, "primeiro dia registrado");
    const seta = (media) => {
      if (media == null || valor == null) return "—";
      const dif = valor - media;
      const simbolo = dif > 0 ? "▲" : dif < 0 ? "▼" : "=";
      return `${simbolo} ${Math.abs(dif).toFixed(casas).replace(".", ",")}`;
    };
    return el(
      "span",
      { class: "comparacao" },
      `7d ${seta(m7)}`,
      el("span", { class: "comparacao__sep" }, "·"),
      `30d ${seta(m30)}`
    );
  };

  const linha = (rotulo, valor, extra) =>
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, rotulo),
      el("span", { class: "resumo__valor" }, valor),
      extra || null
    );

  const pct = (ms) => (atual.msRua > 0 ? `${Math.round((ms / atual.msRua) * 100)}%` : "—");

  falar(
    `Dia fechado. Bruto ${Math.round(atual.saldo)} reais, ` +
      `líquido estimado ${Math.round(atual.liquido)} reais.`
  );

  abrirFolha({
    titulo: `Resumo · ${M.formatarData(jornada.horaInicio)}`,
    classe: "folha--alta",
    conteudo: [
      el(
        "div",
        { class: "resumo__destaque" },
        el("div", { class: "resumo__destaque-rotulo" }, "Líquido estimado"),
        el("div", { class: "resumo__destaque-valor" }, `R$ ${M.formatarReais(atual.liquido)}`),
        el("div", { class: "resumo__destaque-nota" }, `bruto R$ ${M.formatarReais(atual.saldo)}`)
      ),

      el("h3", { class: "resumo__secao" }, "Por plataforma"),
      ...["uber", "99", "indrive"]
        .filter((id) => atual.fontes[id]?.valor > 0)
        .map((id) => linha(id === "99" ? "99" : id === "uber" ? "Uber" : "inDrive", `R$ ${M.formatarReais(atual.fontes[id].valor)}`)),
      atual.fontes.avulso.valor > 0 ? linha("Avulso", `R$ ${M.formatarReais(atual.fontes.avulso.valor)}`) : null,

      el("h3", { class: "resumo__secao" }, "Custos estimados"),
      linha("Energia", `R$ ${M.formatarReais(custos.energia)}`, el("span", { class: "comparacao" }, `${M.formatarReais(custos.energiaKm)}/km`)),
      linha("Desgaste", `R$ ${M.formatarReais(custos.desgaste)}`, el("span", { class: "comparacao" }, `${M.formatarReais(custos.desgasteKm)}/km`)),
      linha("Total", `R$ ${M.formatarReais(custos.total)}`),

      el("h3", { class: "resumo__secao" }, "Tempo e distância"),
      linha("Tempo de rua", M.formatarDuracao(atual.msRua)),
      linha("Tempo ativo", M.formatarDuracao(atual.msAtivo), el("span", { class: "comparacao" }, pct(atual.msAtivo))),
      linha("Tempo parado", M.formatarDuracao(atual.msPausado), el("span", { class: "comparacao" }, pct(atual.msPausado))),
      linha("Distância", `${atual.km.toFixed(1).replace(".", ",")} km`),

      el("h3", { class: "resumo__secao" }, "Rendimento"),
      linha("R$/hora", atual.reaisPorHora == null ? "—" : M.formatarReais(atual.reaisPorHora), comparar("reaisPorHora", atual.reaisPorHora)),
      linha("R$/km", atual.reaisPorKm == null ? "—" : M.formatarReais(atual.reaisPorKm), comparar("reaisPorKm", atual.reaisPorKm)),
      linha("Bruto", `R$ ${M.formatarReais(atual.saldo)}`, comparar("saldo", atual.saldo, 0)),

      jornada.observacoes ? el("p", { class: "resumo__obs" }, jornada.observacoes) : null,
    ],
  });
}
