// feedback.js — vibracao, voz sintetizada e o toast com desfazer.
// Regra do app: nunca perguntar "tem certeza?" — registra e oferece desfazer.

import { cfg } from "./config.js";

const DURACAO_TOAST_MS = 8000;

export function vibrar(padrao = 40) {
  if (!cfg("vibrar")) return;
  if (navigator.vibrate) navigator.vibrate(padrao);
}

export function falar(texto) {
  if (!cfg("tts") || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    fala.rate = 1.05;
    speechSynthesis.speak(fala);
  } catch {
    /* TTS indisponivel; a tela ja mostrou a informacao */
  }
}

let toastAtual = null;

/**
 * Toast grande com botao desfazer. O timer só corre com o app visivel — se o
 * motorista minimizou, os 8 segundos nao devem escorrer sem ele ver.
 */
export function mostrarToast({ titulo, detalhe, aoDesfazer, duracao = DURACAO_TOAST_MS, tom = "ok" }) {
  fecharToast();

  const raiz = document.getElementById("toast-area");
  const el = document.createElement("div");
  el.className = `toast toast--${tom}`;
  el.setAttribute("role", "status");

  const texto = document.createElement("div");
  texto.className = "toast__texto";
  const h = document.createElement("div");
  h.className = "toast__titulo";
  h.textContent = titulo;
  texto.append(h);
  if (detalhe) {
    const d = document.createElement("div");
    d.className = "toast__detalhe";
    d.textContent = detalhe;
    texto.append(d);
  }
  el.append(texto);

  if (aoDesfazer) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "toast__desfazer";
    botao.textContent = "DESFAZER";
    botao.addEventListener("click", async () => {
      fecharToast();
      await aoDesfazer();
    });
    el.append(botao);
  }

  const barra = document.createElement("div");
  barra.className = "toast__barra";
  barra.style.animationDuration = `${duracao}ms`;
  el.append(barra);

  raiz.append(el);

  let restante = duracao;
  let marcado = Date.now();
  let timer = setTimeout(fecharToast, restante);

  const aoTrocarVisibilidade = () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      restante -= Date.now() - marcado;
      barra.style.animationPlayState = "paused";
    } else {
      marcado = Date.now();
      barra.style.animationPlayState = "running";
      timer = setTimeout(fecharToast, Math.max(1500, restante));
    }
  };
  document.addEventListener("visibilitychange", aoTrocarVisibilidade);

  toastAtual = {
    el,
    limpar: () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
    },
  };
  return el;
}

export function fecharToast() {
  if (!toastAtual) return;
  toastAtual.limpar();
  toastAtual.el.remove();
  toastAtual = null;
}
