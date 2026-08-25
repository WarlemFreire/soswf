// tela-registro.js — o fluxo mais usado do app. Meta: 4 segundos do toque em
// REGISTRAR até o toast.
//
// Checkpoint parcial: cada plataforma guarda seu proprio ultimo valor. O
// motorista atualiza só a que mexeu — abrir tres apps a cada checkpoint seria
// inviavel dirigindo.

import { el, abrirFolha, chips } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { cfg, PLATAFORMAS, TIPOS_AVULSO } from "./config.js";
import { vibrar, falar, mostrarToast } from "./feedback.js";

const AJUSTES_MIN = [5, 10, 15, 30];

export function abrirRegistro() {
  const jornada = store.jornadaAtiva();
  if (!jornada) return;
  vibrar();

  const alvos = [
    ...PLATAFORMAS.filter((p) => cfg("plataformasAtivas").includes(p.id)).map((p) => ({
      id: p.id,
      nome: p.nome,
      tipo: "saldo",
    })),
    { id: "avulso", nome: "Avulso", tipo: "avulso" },
  ];

  const valores = { odometro: store.odometroSugerido() };
  let alvo = cfg("plataformaPrincipal");
  let tipoAvulso = "particular";
  let ajusteMs = 0;

  /* ---------------------------------------------------------- elementos */

  const visor = el("div", { class: "visor" }, "0");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "registro__teclado" });
  const linhaAvulso = el("div", { class: "registro__avulso oculto" });
  const linhaHorario = el("div", { class: "registro__horario" });

  const tecladoDinheiro = new Teclado({ modo: "dinheiro", aoMudar: aoDigitar });
  const tecladoOdometro = new Teclado({ modo: "inteiro", aoMudar: aoDigitar, atalhos: [1, 10] });

  const linhaAlvos = chips(alvos, {
    selecionado: alvo,
    classe: "chips--alvos",
    aoEscolher: (id) => {
      selecionarAlvo(id);
      chipOdometro.classList.remove("chip--ativo");
    },
  });

  linhaAvulso.append(
    chips(TIPOS_AVULSO, {
      selecionado: tipoAvulso,
      aoEscolher: (id) => {
        tipoAvulso = id;
      },
    })
  );

  const valorHorario = el("span", { class: "registro__horario-valor" }, "");
  const ajustesHorario = el("div", { class: "registro__ajustes oculto" });

  ajustesHorario.append(
    ...AJUSTES_MIN.map((min) =>
      el(
        "button",
        {
          type: "button",
          class: "chip chip--pequeno",
          onClick: (ev) => {
            ajusteMs = ajusteMs === min * M.MINUTO ? 0 : min * M.MINUTO;
            for (const irmao of ajustesHorario.querySelectorAll(".chip")) {
              irmao.classList.remove("chip--ativo");
            }
            if (ajusteMs) ev.currentTarget.classList.add("chip--ativo");
            atualizarHorario();
            vibrar(8);
          },
        },
        `−${min}min`
      )
    )
  );

  const chipOdometro = el(
    "button",
    {
      type: "button",
      class: "chip chip--pequeno",
      onClick: () => {
        selecionarAlvo(alvo === "odometro" ? cfg("plataformaPrincipal") : "odometro");
        chipOdometro.classList.toggle("chip--ativo", alvo === "odometro");
        vibrar(8);
      },
    },
    "📍 odômetro"
  );

  linhaHorario.append(
    el(
      "button",
      {
        type: "button",
        class: "chip chip--pequeno",
        onClick: () => {
          ajustesHorario.classList.toggle("oculto");
          vibrar(8);
        },
      },
      "⏱ ajustar"
    ),
    chipOdometro,
    valorHorario
  );

  const confirmar = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", onClick: gravar },
    "CONFIRMAR"
  );

  const folha = abrirFolha({
    titulo: "Registrar",
    classe: "folha--alta folha--registro",
    conteudo: [linhaAlvos, visor, legenda, linhaAvulso, caixaTeclado],
    rodape: [ajustesHorario, linhaHorario, confirmar],
  });

  selecionarAlvo(alvo);

  /* ------------------------------------------------------------- logica */

  function tecladoDoAlvo() {
    return alvo === "odometro" ? tecladoOdometro : tecladoDinheiro;
  }

  function selecionarAlvo(id) {
    // Guarda o que estava digitado antes de trocar de destino.
    valores[alvo] = tecladoDoAlvo().valor;
    alvo = id;

    const teclado = tecladoDoAlvo();
    caixaTeclado.replaceChildren(teclado.el);
    teclado.definir(valores[id] ?? null);

    linhaAvulso.classList.toggle("oculto", id !== "avulso");
    atualizarLegenda();
    atualizarResumo();
  }

  function aoDigitar() {
    visor.textContent = tecladoDoAlvo().exibicao;
    valores[alvo] = tecladoDoAlvo().valor;
    atualizarResumo();
  }

  function atualizarLegenda() {
    visor.textContent = tecladoDoAlvo().exibicao;
    if (alvo === "odometro") {
      const inicio = store.jornadaAtiva()?.odometroInicio;
      legenda.textContent = `Abertura: ${inicio?.toLocaleString("pt-BR") ?? "—"} km`;
      visor.classList.add("visor--odometro");
      return;
    }
    visor.classList.remove("visor--odometro");
    if (alvo === "avulso") {
      legenda.textContent = "Valor recebido nesta corrida (soma ao dia)";
      return;
    }
    const fonte = store.saldoDaFonte(alvo);
    legenda.textContent = fonte.visto
      ? `Último: R$ ${M.formatarReais(fonte.valor)} às ${M.formatarHora(fonte.visto)}`
      : "Ainda sem valor hoje — digite o total do dia nesta plataforma";
  }

  function atualizarHorario() {
    valorHorario.textContent = M.formatarHora(Date.now() - ajusteMs);
    valorHorario.classList.toggle("registro__horario-valor--ajustado", ajusteMs > 0);
  }

  function atualizarResumo() {
    const pronto = temAlgoParaGravar();
    const delta = store.deltaSimulado(payload());
    confirmar.disabled = !pronto;
    confirmar.textContent =
      pronto && delta > 0
        ? `CONFIRMAR  +R$ ${M.formatarReais(delta, { comCentavos: false })}`
        : "CONFIRMAR";
  }

  function temAlgoParaGravar() {
    if (valores.avulso > 0) return true;
    if (PLATAFORMAS.some((p) => valores[p.id] != null)) return true;
    return valores.odometro != null && valores.odometro !== store.odometroSugerido();
  }

  function payload() {
    const saldos = {};
    for (const p of PLATAFORMAS) if (valores[p.id] != null) saldos[p.id] = valores[p.id];
    return {
      saldos,
      avulso: valores.avulso > 0 ? { valor: valores.avulso, tipo: tipoAvulso } : null,
      odometro: valores.odometro,
      timestamp: Date.now() - ajusteMs,
    };
  }

  async function gravar() {
    valores[alvo] = tecladoDoAlvo().valor;
    if (!temAlgoParaGravar()) return;

    const dados = payload();
    const delta = store.deltaSimulado(dados);

    // Saldo caindo é normal (cancelamento, estorno), mas o erro mais provável
    // com tres plataformas é digitar o valor certo no chip errado. Por isso a
    // unica confirmacao do app inteiro mora aqui.
    if (delta < 0) {
      const confirmado = await confirmarQueda(delta);
      if (!confirmado) return;
    }

    const antes = store.metricas().saldo;
    const registro = await store.registrar(dados);
    folha.fechar();
    anunciar(registro, antes);
  }

  atualizarHorario();
  atualizarResumo();
}

/* ------------------------------------------------------------- auxiliares */

function confirmarQueda(delta) {
  return new Promise((resolver) => {
    let folha;
    let respondido = false;
    const responder = (valor) => {
      respondido = true;
      folha.fechar();
      resolver(valor);
    };
    folha = abrirFolha({
      titulo: "O saldo caiu",
      aoFechar: () => !respondido && resolver(false),
      conteudo: [
        el(
          "p",
          { class: "folha__ajuda" },
          `Este registro tira R$ ${M.formatarReais(Math.abs(delta))} do dia. ` +
            "Foi cancelamento ou ajuste da plataforma, ou o valor foi digitado no app errado?"
        ),
        el(
          "div",
          { class: "acoes acoes--coluna" },
          el(
            "button",
            { type: "button", class: "botao botao--primario botao--gigante", onClick: () => responder(true) },
            "Foi ajuste — registrar"
          ),
          el(
            "button",
            { type: "button", class: "botao botao--secundario botao--gigante", onClick: () => responder(false) },
            "Voltar e corrigir"
          )
        ),
      ],
    });
  });
}

function anunciar(registro, saldoAntes) {
  const m = store.metricas();
  const trecho = store.trechoAtual();
  const delta = m.saldo - saldoAntes;

  const partes = [];
  if (trecho && trecho.confiavel && trecho.reaisPorHora != null) {
    partes.push(`${trecho.reaisPorHora.toFixed(0)} R$/h neste trecho`);
  }
  if (trecho && trecho.km >= 1 && trecho.reaisPorKm != null) {
    partes.push(`${trecho.reaisPorKm.toFixed(2).replace(".", ",")} R$/km`);
  }
  if (!partes.length) partes.push(`saldo R$ ${M.formatarReais(m.saldo, { comCentavos: false })}`);

  const titulo =
    delta === 0
      ? "Registrado"
      : `${delta > 0 ? "+" : "−"}R$ ${M.formatarReais(Math.abs(delta), { comCentavos: false })}`;

  vibrar(delta >= 0 ? 40 : [20, 60, 20]);
  mostrarToast({
    titulo,
    detalhe: partes.join(" · "),
    tom: delta < 0 ? "alerta" : "ok",
    aoDesfazer: async () => {
      await store.desfazerRegistro(registro.id);
      vibrar([15, 40, 15]);
    },
  });
  falar(`${titulo.replace("R$", "reais").replace("−", "menos ")}. ${partes[0]}.`);

  celebrarMetas(saldoAntes, m.saldo);
}

function celebrarMetas(antes, depois) {
  const jornada = store.jornadaAtiva();
  if (!jornada) return;
  const metas = {
    metaMinima: jornada.metaMinima,
    metaIdeal: jornada.metaIdeal,
    metaOtima: jornada.metaOtima,
  };
  const cruzados = M.patamares(metas).filter((p) => antes < p.alvo && depois >= p.alvo);
  if (!cruzados.length) return;
  const patamar = cruzados[cruzados.length - 1];
  setTimeout(() => {
    vibrar([40, 60, 40, 60, 80]);
    falar(`Meta ${patamar.nome} batida.`);
  }, 400);
}
