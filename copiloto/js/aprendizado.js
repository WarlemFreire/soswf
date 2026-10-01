// aprendizado.js — o placar das sugestões. É aqui que mora o aprendizado.
//
// POR QUE ISTO EXISTE. Modelo de linguagem não aprende entre chamadas. Se o
// assistente "lembrasse" só porque mandamos mais histórico, ele estaria
// fingindo: na chamada seguinte não restaria nada do que ele concluiu antes.
//
// Então a memória é do app. Cada sugestão vira uma APOSTA registrada, com o
// número que ela prometia mexer. Depois, o app mede o que aconteceu de fato
// naquele período e marca se rendeu ou não. O placar volta no contexto da
// próxima pergunta -- e aí o assistente tem o que nenhum modelo tem sozinho:
// o histórico do que ELE sugeriu e no que deu.
//
// A MEDIÇÃO É CEGA AO QUE FOI PROMETIDO. O app compara o R$/h do período
// seguido contra o padrão dele para aquele mesmo dia e hora. Não pergunta ao
// modelo se deu certo, nem deixa o modelo se avaliar: quem julga é a aritmética.
//
// E O QUE NÃO DÁ PARA SABER FICA COMO "NÃO DÁ PARA SABER". Se ele não seguiu a
// sugestão, ou se não houve jornada no período, a aposta fica sem resultado em
// vez de virar um sucesso ou um fracasso inventado.

import * as M from "./metrics.js";
import { db, novoId } from "./db.js";

/** Abaixo disto a diferença é ruído, não efeito. */
const DIFERENCA_MINIMA_PCT = 8;

/** Apostas mais velhas que isto não descrevem mais a cidade nem ele. */
const VALIDADE_DIAS = 60;

export const RESULTADOS = {
  RENDEU: "rendeu",
  NAO_RENDEU: "nao-rendeu",
  IGUAL: "igual",
  SEM_DADO: "sem-dado",
};

/**
 * Registra uma sugestão como aposta mensurável.
 *
 * `alvo` diz o que ela pretendia mexer, e é o que será medido depois:
 * `{ tipo: "reaisPorHora", periodo: "tarde" }` ou `{ tipo: "reaisPorHora" }`.
 */
export async function registrar({ texto, alvo = { tipo: "reaisPorHora" }, quando = Date.now() }) {
  const aposta = {
    id: novoId(),
    quando,
    texto: String(texto || "").slice(0, 400),
    alvo,
    // Preenchidos depois, pela medição.
    seguiu: null,
    resultado: null,
    medidoEm: null,
    antes: null,
    depois: null,
  };
  await db.put("estrategias", aposta);
  return aposta;
}

/** Ele diz se seguiu ou não. Sem isso, não dá para atribuir o resultado. */
export async function marcarSeguiu(id, seguiu) {
  const aposta = await db.get("estrategias", id);
  if (!aposta) return null;
  const atualizada = { ...aposta, seguiu: Boolean(seguiu) };
  await db.put("estrategias", atualizada);
  return atualizada;
}

export async function apostas() {
  const todas = await db.todos("estrategias");
  return todas.sort((a, b) => b.quando - a.quando);
}

/**
 * Mede uma aposta: o que rendeu DEPOIS dela contra o padrão dele ANTES.
 *
 * Pura de propósito -- é o juiz, e juiz precisa ser verificável sem banco.
 *
 * @param {object} aposta
 * @param {Array} trechos  todos os trechos de ganho, com inicio/fim/valor/ms
 * @param {number} agora
 */
export function medir(aposta, trechos, agora = Date.now()) {
  if (!aposta) return null;
  if (aposta.seguiu === false) {
    return { ...aposta, resultado: RESULTADOS.SEM_DADO, medidoEm: agora, motivo: "não seguiu" };
  }

  const janelaMs = 7 * 86400000;
  const depois = janela(trechos, aposta.quando, aposta.quando + janelaMs, aposta.alvo);
  const antes = janela(trechos, aposta.quando - janelaMs, aposta.quando, aposta.alvo);

  if (depois == null || antes == null) {
    return { ...aposta, resultado: RESULTADOS.SEM_DADO, medidoEm: agora, motivo: "sem jornada suficiente" };
  }

  const diferenca = ((depois - antes) / antes) * 100;
  const resultado =
    Math.abs(diferenca) < DIFERENCA_MINIMA_PCT
      ? RESULTADOS.IGUAL
      : diferenca > 0
        ? RESULTADOS.RENDEU
        : RESULTADOS.NAO_RENDEU;

  return {
    ...aposta,
    antes: arredondar(antes, 2),
    depois: arredondar(depois, 2),
    diferencaPct: arredondar(diferenca, 1),
    resultado,
    medidoEm: agora,
  };
}

/** R$/h no intervalo, filtrado pelo período da aposta quando houver. */
function janela(trechos, inicio, fim, alvo) {
  const dentro = (trechos || []).filter((t) => {
    if (t.inicio < inicio || t.inicio >= fim) return false;
    // O trecho já traz o período classificado; recalcular aqui abriria espaço
    // para as duas contas divergirem.
    const periodo = t.periodo ?? M.periodoDe(t.inicio);
    if (alvo?.periodo && periodo !== alvo.periodo) return false;
    return true;
  });
  if (dentro.length < 3) return null;

  const ms = dentro.reduce((s, t) => s + t.ms, 0);
  const valor = dentro.reduce((s, t) => s + t.valor, 0);
  if (!(ms > 0)) return null;
  return valor / (ms / M.HORA);
}

/**
 * O placar que volta no contexto da próxima pergunta.
 *
 * Só apostas já medidas e ainda recentes. Uma aposta de três meses atrás não
 * descreve mais nem a cidade nem o jeito dele de rodar.
 */
export function placar(apostasMedidas, agora = Date.now()) {
  const corte = agora - VALIDADE_DIAS * 86400000;
  const recentes = (apostasMedidas || []).filter((a) => a.quando >= corte && a.resultado);

  const conta = (r) => recentes.filter((a) => a.resultado === r).length;

  return {
    total: recentes.length,
    renderam: conta(RESULTADOS.RENDEU),
    naoRenderam: conta(RESULTADOS.NAO_RENDEU),
    iguais: conta(RESULTADOS.IGUAL),
    semDado: conta(RESULTADOS.SEM_DADO),
    // As que deram certo e as que não, para o modelo não repetir o que falhou.
    exemplos: recentes
      .filter((a) => a.resultado === RESULTADOS.RENDEU || a.resultado === RESULTADOS.NAO_RENDEU)
      .slice(0, 10)
      .map((a) => ({
        quando: M.chaveData(a.quando),
        sugestao: a.texto,
        resultado: a.resultado,
        diferencaPct: a.diferencaPct ?? null,
      })),
  };
}

/** Mede o que ainda não foi medido e tem idade para isso. */
export async function medirPendentes(trechos, agora = Date.now()) {
  const todas = await apostas();
  const maduras = todas.filter(
    (a) => !a.resultado && agora - a.quando >= 7 * 86400000
  );

  const medidas = [];
  for (const a of maduras) {
    const m = medir(a, trechos, agora);
    await db.put("estrategias", m);
    medidas.push(m);
  }
  return medidas;
}

function arredondar(valor, casas) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
