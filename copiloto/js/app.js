// app.js — inicializacao, tema, navegacao e o lembrete de pausa longa.

import { carregarConfig, cfg } from "./config.js";
import * as store from "./store.js";
import { trocarTela } from "./ui.js";
import { montarAgora } from "./tela-agora.js";
import { montarHistorico, montarAnalise } from "./tela-historico.js";
import { montarConfig } from "./tela-config.js";
import { religarAoVoltar, manterTelaLigada } from "./geo.js";
import { mostrarToast, vibrar, falar } from "./feedback.js";
import { formatarDuracao, MINUTO } from "./metrics.js";

const TELAS = {
  agora: () => {},
  historico: () => montarHistorico(document.getElementById("tela-historico")),
  analise: () => montarAnalise(document.getElementById("tela-analise")),
  config: () => montarConfig(document.getElementById("tela-config")),
};

async function iniciar() {
  await carregarConfig();
  aplicarTema();
  document.addEventListener("copiloto:tema", aplicarTema);
  // O tema automatico vira sozinho às 18h sem precisar recarregar.
  setInterval(aplicarTema, 60000);

  montarAgora(document.getElementById("tela-agora"));
  await store.carregarJornadaAberta();

  for (const aba of document.querySelectorAll(".rodape__item")) {
    aba.addEventListener("click", () => {
      const id = aba.dataset.tela;
      trocarTela(id);
      TELAS[id]?.();
      if (navigator.vibrate && cfg("vibrar")) navigator.vibrate(8);
    });
  }

  religarAoVoltar(() => cfg("manterTelaLigada") && !!store.jornadaAtiva());
  if (cfg("manterTelaLigada") && store.jornadaAtiva()) manterTelaLigada();

  vigiarPausa();
  registrarServiceWorker();
}

/* --------------------------------------------------------------- tema */

function aplicarTema() {
  const escolha = cfg("tema");
  const hora = new Date().getHours();
  const noturnoAutomatico = hora >= cfg("horaModoNoturno") || hora < 6;
  const escuro = escolha === "escuro" || (escolha === "auto" && noturnoAutomatico);
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", escuro ? "#0b0f14" : "#f4f6fa");
}

/* -------------------------------------------------------- pausa longa */

let pausaAvisada = null;

function vigiarPausa() {
  setInterval(() => {
    const pausa = store.pausaEmCurso();
    if (!pausa) {
      pausaAvisada = null;
      return;
    }
    const limite = cfg("alertaPausaMin") * MINUTO;
    if (pausaAvisada === pausa.id || Date.now() - pausa.horaInicio < limite) return;

    pausaAvisada = pausa.id;
    const decorrido = formatarDuracao(Date.now() - pausa.horaInicio);
    vibrar([30, 80, 30]);
    mostrarToast({
      titulo: `Parado há ${decorrido}`,
      detalhe: "O relógio está parado — nada está sendo contado.",
      tom: "alerta",
      duracao: 12000,
    });
    falar(`Você está parado há ${decorrido}.`);
  }, 30000);
}

/* ----------------------------------------------------- service worker */

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // iniciar() é async: quando chegamos aqui o evento `load` normalmente já
  // passou, e um listener registrado depois nunca dispararia.
  const registrar = () =>
    navigator.serviceWorker.register("./sw.js").catch((erro) => {
      // Sem service worker o app ainda funciona online; só perde o offline.
      console.warn("Service worker não registrado:", erro.message);
    });
  if (document.readyState === "complete") registrar();
  else window.addEventListener("load", registrar, { once: true });
}

iniciar();
