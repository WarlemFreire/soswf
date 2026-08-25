// tela-agora.js — a tela que fica aberta 90% do tempo. Responde uma pergunta
// só: "como estou indo agora?".

import { el, limpar, abrirFolha, chips } from "./ui.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { cfg, configAtual, salvarConfig, MOTIVOS_PAUSA, PLATAFORMAS } from "./config.js";
import { vibrar, falar } from "./feedback.js";
import { abrirRegistro } from "./tela-registro.js";
import { abrirCorrida, iniciarCronometro } from "./tela-corrida.js";
import { abrirFechamento } from "./tela-fechamento.js";
import { Teclado } from "./keypad.js";

const NOME_NIVEL = { abaixo: "abaixo", piso: "piso", ideal: "ideal", otimo: "ótimo" };

export function montarAgora(raiz) {
  const desenhar = () => render(raiz);
  store.assinar(desenhar);
  // O relogio corre, entao a tela precisa do tique de 1s. Mas nao ha por que
  // redesenhar atras de uma folha aberta ou com o app em segundo plano — sao
  // 10 horas de bateria em jogo.
  setInterval(() => {
    if (document.hidden || document.querySelector(".folha-fundo")) return;
    desenhar();
  }, 1000);
  desenhar();
}

function render(raiz) {
  const jornada = store.jornadaAtiva();
  limpar(raiz);
  raiz.append(jornada ? painelAtivo() : painelParado());
}

/* ------------------------------------------------------ jornada parada */

function painelParado() {
  return el(
    "div",
    { class: "vazio" },
    el("div", { class: "vazio__marca" }, "Copiloto"),
    el("p", { class: "vazio__texto" }, "Nenhuma jornada aberta."),
    el(
      "button",
      { type: "button", class: "botao botao--primario botao--gigante", onClick: perguntarOdometro },
      "ABRIR JORNADA"
    ),
    el("p", { class: "vazio__dica" }, "Um toque aqui, o odômetro, e você está rodando.")
  );
}

function perguntarOdometro() {
  vibrar();
  const teclado = new Teclado({ modo: "inteiro", aoMudar: () => atualizar() });
  const visor = el("div", { class: "visor visor--odometro" }, "—");
  const botao = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", disabled: true, onClick: confirmar },
    "COMEÇAR"
  );

  function atualizar() {
    visor.textContent = teclado.exibicao;
    botao.disabled = teclado.valor == null || teclado.valor <= 0;
  }

  let folha;
  async function confirmar() {
    if (teclado.valor == null) return;
    await store.abrirJornada({ odometroInicio: teclado.valor });
    vibrar([30, 40, 30]);
    falar("Jornada aberta.");
    folha.fechar();
  }

  folha = abrirFolha({
    titulo: "Odômetro agora",
    classe: "folha--alta",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "O número do painel. Só entra duas vezes por dia: agora e no fim."),
      visor,
      teclado.el,
    ],
    rodape: [botao],
  });
}

/* ------------------------------------------------------ jornada ativa */

function painelAtivo() {
  const m = store.metricas();
  const pausa = store.pausaEmCurso();
  const config = configAtual();
  const dirigindo = cfg("modoDirigindo");

  const raiz = el("div", { class: `agora ${pausa ? "agora--pausado" : ""}`.trim() });

  raiz.append(blocoSaldo(m, pausa));

  if (dirigindo) {
    raiz.append(
      el("div", { class: "metricas metricas--reduzida" }, tile("R$/hora", m.reaisPorHora, m.nivelHora, 2))
    );
    raiz.append(blocoAcoes(pausa, true));
    return raiz;
  }

  raiz.append(
    el(
      "div",
      { class: "metricas" },
      tile("R$/hora", m.reaisPorHora, m.nivelHora, 2),
      tile("R$/km", m.reaisPorKm, m.nivelKm, 2),
      tileTempo(m)
    )
  );

  raiz.append(medidorKm(m, config));
  raiz.append(barraMeta(m));
  raiz.append(linhaProjecao(m));
  raiz.append(blocoAcoes(pausa, false));
  raiz.append(rodapeDados(m, config));

  return raiz;
}

function blocoSaldo(m, pausa) {
  if (pausa) {
    const motivo = MOTIVOS_PAUSA.find((x) => x.id === pausa.motivo);
    return el(
      "section",
      { class: "saldo saldo--pausa" },
      el("div", { class: "saldo__rotulo" }, `Em pausa · ${motivo?.nome || pausa.motivo}`),
      el("div", { class: "cronometro" }, M.formatarDuracao(Date.now() - pausa.horaInicio)),
      el("div", { class: "saldo__nota" }, `Relógio parado. Saldo R$ ${M.formatarReais(m.saldo)}`)
    );
  }
  return el(
    "section",
    { class: "saldo" },
    el("div", { class: "saldo__rotulo" }, "Saldo do dia"),
    el(
      "div",
      { class: "saldo__valor" },
      el("span", { class: "saldo__cifrao" }, "R$"),
      M.formatarReais(m.saldo, { comCentavos: false })
    )
  );
}

function tile(rotulo, valor, nivel, casas) {
  return el(
    "div",
    { class: `tile tile--${nivel || "neutro"}` },
    el("div", { class: "tile__rotulo" }, rotulo),
    el("div", { class: "tile__valor" }, valor == null ? "—" : valor.toFixed(casas).replace(".", ",")),
    el("div", { class: "tile__nivel" }, nivel ? NOME_NIVEL[nivel] : "sem dados")
  );
}

function tileTempo(m) {
  return el(
    "div",
    { class: "tile tile--neutro" },
    el("div", { class: "tile__rotulo" }, "Ativo"),
    el("div", { class: "tile__valor" }, M.formatarDuracao(m.msAtivo)),
    el("div", { class: "tile__nivel" }, `rua ${M.formatarDuracao(m.msRua)}`)
  );
}

/**
 * Medidor do R$/km com as tres faixas do periodo e a linha de break-even —
 * o unico numero do app que nao é opiniao: abaixo dele o dia dá prejuízo.
 */
function medidorKm(m, config) {
  const custos = M.custosEstimados(1, config);
  const teto = Math.max(m.faixaKm.otimo * 1.25, (m.reaisPorKm ?? 0) * 1.1, custos.totalKm * 1.5);
  const piso = custos.totalKm * 0.6;
  const faixa = teto - piso;
  const pct = (v) => `${Math.min(100, Math.max(0, ((v - piso) / faixa) * 100))}%`;
  // Larguras das zonas sao proporcionais a mesma escala deslocada.
  const largura = (v) => `${Math.min(100, Math.max(0, (v / faixa) * 100))}%`;

  const trilha = el(
    "div",
    { class: "medidor__trilha" },
    el("div", { class: "medidor__zona medidor__zona--abaixo", style: { width: pct(m.faixaKm.piso) } }),
    el("div", {
      class: "medidor__zona medidor__zona--piso",
      style: { width: largura(m.faixaKm.ideal - m.faixaKm.piso) },
    }),
    el("div", {
      class: "medidor__zona medidor__zona--ideal",
      style: { width: largura(m.faixaKm.otimo - m.faixaKm.ideal) },
    }),
    el("div", { class: "medidor__zona medidor__zona--otimo", style: { flex: "1" } }),
    el("div", {
      class: "medidor__breakeven",
      style: { left: pct(custos.totalKm) },
      title: `Custo real R$ ${M.formatarReais(custos.totalKm)}/km`,
    }),
    m.reaisPorKm != null
      ? el("div", { class: "medidor__agulha", style: { left: pct(m.reaisPorKm) } })
      : null
  );

  return el(
    "section",
    { class: "medidor" },
    trilha,
    el(
      "div",
      { class: "medidor__legenda" },
      el("span", {}, `chão R$ ${M.formatarReais(custos.totalKm)}`),
      el("span", {}, `piso ${m.faixaKm.piso.toFixed(2).replace(".", ",")}`),
      el("span", {}, `ideal ${m.faixaKm.ideal.toFixed(2).replace(".", ",")}`),
      el("span", {}, `ótimo ${m.faixaKm.otimo.toFixed(2).replace(".", ",")}`)
    )
  );
}

function barraMeta(m) {
  const jornada = store.jornadaAtiva();
  const metas = {
    metaMinima: jornada.metaMinima,
    metaIdeal: jornada.metaIdeal,
    metaOtima: jornada.metaOtima,
  };
  const lista = M.patamares(metas);
  const teto = Math.max(lista[lista.length - 1].alvo, m.saldo) * 1.02;
  const pct = (v) => `${Math.min(100, (v / teto) * 100)}%`;
  const proximo = M.proximoPatamar(m.saldo, metas);

  return el(
    "section",
    { class: "meta" },
    el(
      "div",
      { class: "meta__barra" },
      el("div", { class: "meta__preenchimento", style: { width: pct(m.saldo) } }),
      ...lista.map((p, i) =>
        el(
          "div",
          {
            class: `meta__marca ${m.saldo >= p.alvo ? "meta__marca--batida" : ""}`.trim(),
            style: { left: pct(p.alvo) },
          },
          // O ultimo marcador encosta na borda: ancorar pela direita evita que
          // o rotulo saia da tela.
          el(
            "span",
            { class: `meta__marca-rotulo ${i === lista.length - 1 ? "meta__marca-rotulo--fim" : ""}`.trim() },
            p.nome
          )
        )
      )
    ),
    el(
      "div",
      { class: "meta__texto" },
      proximo
        ? el(
            "span",
            {},
            "Faltam ",
            el("strong", {}, `R$ ${M.formatarReais(proximo.alvo - m.saldo, { comCentavos: false })}`),
            ` para a ${proximo.nome.toLowerCase()}`
          )
        : el("span", { class: "meta__texto--completa" }, "Todas as metas batidas hoje 🎉")
    )
  );
}

function linhaProjecao(m) {
  const jornada = store.jornadaAtiva();
  const alvo = M.proximoPatamar(m.saldo, {
    metaMinima: jornada.metaMinima,
    metaIdeal: jornada.metaIdeal,
    metaOtima: jornada.metaOtima,
  });
  if (!alvo) return el("p", { class: "projecao" }, "Tudo batido. O resto do dia é lucro.");

  const p = M.projecao(m.saldo, m.msAtivo, alvo.alvo);
  if (!p) return el("p", { class: "projecao projecao--fraca" }, "Ritmo ainda sem medida — registre um saldo.");

  const limite = new Date();
  limite.setHours(cfg("horaLimiteMeta"), 0, 0, 0);
  if (p.quando > limite.getTime()) {
    return el(
      "p",
      { class: "projecao projecao--alerta" },
      `Meta ${alvo.nome.toLowerCase()} fora de alcance no ritmo atual`
    );
  }
  return el("p", { class: "projecao" }, `No ritmo atual, meta ${alvo.nome.toLowerCase()} às ${M.formatarHora(p.quando)}`);
}

function blocoAcoes(pausa, reduzido) {
  const registrar = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", onClick: () => abrirRegistro() },
    "+ REGISTRAR"
  );
  if (reduzido) return el("div", { class: "acoes" }, registrar);

  const emCurso = store.corridaEmCurso();
  const corrida = emCurso
    ? el(
        "button",
        {
          type: "button",
          class: "botao botao--corrida botao--gigante acoes__larga",
          onClick: () => abrirCorrida(),
        },
        `■ FIM DA CORRIDA · ${M.formatarDuracao(Date.now() - emCurso.inicio)}`
      )
    : el(
        "div",
        { class: "acoes__larga acoes__dupla" },
        el(
          "button",
          { type: "button", class: "botao botao--secundario botao--gigante", onClick: iniciarCronometro },
          "▶ INICIAR CORRIDA"
        ),
        el(
          "button",
          { type: "button", class: "botao botao--secundario botao--gigante", onClick: () => abrirCorrida() },
          "✎ LANÇAR"
        )
      );

  const pausar = pausa
    ? el(
        "button",
        {
          type: "button",
          class: "botao botao--retomar botao--gigante",
          onClick: async () => {
            await store.encerrarPausa();
            vibrar([30, 40, 30]);
            falar("Retomando.");
          },
        },
        "▶ RETOMAR"
      )
    : el(
        "button",
        { type: "button", class: "botao botao--secundario botao--gigante", onClick: escolherPausa },
        "⏸ PAUSAR"
      );

  return el("div", { class: "acoes" }, registrar, pausar, corrida);
}

function escolherPausa() {
  vibrar();
  let folha;
  const grade = chips(MOTIVOS_PAUSA, {
    classe: "chips--grade",
    aoEscolher: async (id) => {
      await store.iniciarPausa(id);
      vibrar([25, 30, 25]);
      falar("Pausa iniciada. Relógio parado.");
      folha.fechar();
    },
  });
  folha = abrirFolha({ titulo: "Pausa — por quê?", conteudo: [grade] });
}

/**
 * Quantas corridas foram lancadas e se elas batem com o saldo. Uma diferenca
 * grande quase sempre é corrida esquecida — melhor descobrir hoje do que na
 * hora de fechar a planilha.
 */
function linhaCorridas() {
  const corridas = store.corridasDoDia();
  if (!corridas.length) return null;
  const conferencia = store.conferencia();
  const somado = M.somaCorridas(corridas);

  const texto = `${corridas.length} corrida${corridas.length > 1 ? "s" : ""} lançada${
    corridas.length > 1 ? "s" : ""
  } · R$ ${M.formatarReais(somado, { comCentavos: false })}`;

  if (!conferencia || conferencia.fecha) {
    return el("div", { class: "dados__fontes" }, texto);
  }
  return el(
    "div",
    { class: "dados__fontes dados__fontes--alerta" },
    `${texto} · faltam R$ ${M.formatarReais(Math.abs(conferencia.diferenca), { comCentavos: false })} para bater com o saldo`
  );
}

function rodapeDados(m, config) {
  const custos = M.custosEstimados(m.km, config);
  const liquido = m.saldo - custos.total;
  const fontes = PLATAFORMAS.filter((p) => m.fontes[p.id]?.valor > 0).map(
    (p) => `${p.nome} ${M.formatarReais(m.fontes[p.id].valor, { comCentavos: false })}`
  );
  if (m.fontes.avulso.valor > 0) {
    fontes.push(`avulso ${M.formatarReais(m.fontes.avulso.valor, { comCentavos: false })}`);
  }

  const estado = store.snapshot();
  const gps = !cfg("usarGps")
    ? "GPS desligado"
    : estado.gpsErro
      ? "GPS sem sinal"
      : estado.gpsAtivo
        ? "GPS ativo"
        : "GPS aguardando";

  return el(
    "section",
    { class: "dados" },
    el(
      "div",
      { class: "dados__linha" },
      el("span", {}, `${m.km.toFixed(1).replace(".", ",")} km`),
      el("span", {}, `líquido ≈ R$ ${M.formatarReais(liquido, { comCentavos: false })}`),
      el("span", { class: "dados__gps" }, gps)
    ),
    fontes.length ? el("div", { class: "dados__fontes" }, fontes.join(" · ")) : null,
    linhaCorridas(),
    el(
      "div",
      { class: "dados__botoes" },
      el(
        "button",
        {
          type: "button",
          class: "botao botao--texto",
          onClick: async () => {
            await salvarConfig("modoDirigindo", !cfg("modoDirigindo"));
            store.notificar();
          },
        },
        cfg("modoDirigindo") ? "Sair do modo dirigindo" : "Modo dirigindo"
      ),
      el("button", { type: "button", class: "botao botao--texto", onClick: () => abrirFechamento() }, "Encerrar jornada")
    )
  );
}
