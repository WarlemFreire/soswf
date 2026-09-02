// faixas.js — as faixas de referência, medidas no histórico do próprio
// motorista. Puro: sem DOM, sem banco.
//
// Duas escalas convivem aqui, e misturá-las já custou caro neste projeto:
//
//   JORNADA  — valor ÷ km rodado de verdade, dead km incluído. É contra ela
//              que os medidores da tela principal comparam o desempenho.
//   CORRIDA  — valor ÷ km da corrida ofertada. É a escala da decisão de
//              aceitar ou recusar, e dá um número quase o dobro do outro.
//
// Cada função abaixo declara em qual das duas trabalha, e nada aqui converte
// uma na outra.

import * as M from "./metrics.js";
import { PERIODOS } from "./config.js";

/** Amostra mínima para uma faixa medida substituir a semente dos Ajustes. */
export const MINIMO_TRECHOS = 8;
export const MINIMO_CORRIDAS = 12;

/** Onde caem piso, ideal e ótimo dentro da distribuição do próprio histórico. */
const CORTES = { piso: 0.3, ideal: 0.55, otimo: 0.8 };

/* --------------------------------------------------------------- trechos */

const odometroValido = (v) => Number.isFinite(v) && v > 0;

/**
 * Os trechos entre checkpoints, em escala de JORNADA.
 *
 * O km só existe quando as DUAS pontas do trecho têm odômetro digitado. Herdar
 * a última âncora conhecida faria o km de um trecho vazar para o seguinte, e o
 * R$/km sairia atribuído à hora errada.
 */
export function trechosDe(jornadas, registros) {
  const saida = [];

  for (const jornada of jornadas || []) {
    if (jornada.origem === "planilha") continue; // sem checkpoints reais
    const doDia = (registros || []).filter((r) => r.jornadaId === jornada.id);
    const validos = M.registrosValidos(doDia).slice().sort((a, b) => a.timestamp - b.timestamp);
    if (!validos.length) continue;
    const eventos = M.eventosDoDia([jornada], doDia);

    let quando = jornada.horaInicio;
    let odometro = odometroValido(jornada.odometroInicio) ? jornada.odometroInicio : null;

    for (const r of validos) {
      const ms = r.timestamp - quando;
      const valor = M.saldoEm(eventos, r.timestamp) - M.saldoEm(eventos, quando);
      const aqui = odometroValido(r.odometro) ? r.odometro : null;
      const km = odometro != null && aqui != null ? aqui - odometro : null;

      if (ms > 0 && valor > 0) {
        saida.push({
          inicio: quando,
          fim: r.timestamp,
          ms,
          valor,
          km: km > 0 ? km : null,
          periodo: M.periodoDe(quando),
          reaisPorHora: valor / (ms / M.HORA),
          reaisPorKm: km > 0 ? valor / km : null,
        });
      }
      quando = r.timestamp;
      odometro = aqui;
    }
  }
  return saida;
}

/* -------------------------------------------------------------- percentis */

/** Percentil com interpolação. Lista vazia devolve null, nunca zero. */
export function percentil(valores, p) {
  const ordenada = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ordenada.length) return null;
  const posicao = (ordenada.length - 1) * p;
  const baixo = Math.floor(posicao);
  const alto = Math.ceil(posicao);
  if (baixo === alto) return ordenada[baixo];
  return ordenada[baixo] + (ordenada[alto] - ordenada[baixo]) * (posicao - baixo);
}

/**
 * Piso, ideal e ótimo a partir de uma amostra.
 *
 * Amostra curta devolve null de propósito: três trechos não descrevem um
 * período, e uma faixa inventada a partir deles daria ao número um ar de
 * medição que ele não tem.
 */
export function faixaDe(valores, { minimo, chao = null } = {}) {
  const amostra = valores.filter((v) => Number.isFinite(v) && v > 0);
  if (amostra.length < minimo) return null;

  const bruta = {
    piso: percentil(amostra, CORTES.piso),
    ideal: percentil(amostra, CORTES.ideal),
    otimo: percentil(amostra, CORTES.otimo),
  };

  // Um piso abaixo do custo por km não é piso: ali o motorista paga para
  // trabalhar. O chão econômico segura a faixa por baixo.
  const piso = chao != null ? Math.max(bruta.piso, chao) : bruta.piso;
  return {
    piso,
    ideal: Math.max(bruta.ideal, piso),
    otimo: Math.max(bruta.otimo, Math.max(bruta.ideal, piso)),
    n: amostra.length,
    medida: true,
  };
}

/* ------------------------------------------------- faixas de jornada */

/**
 * As faixas por período em escala de JORNADA, medidas nos trechos. O que não
 * tem amostra fica com a semente dos Ajustes, marcada como não medida.
 */
export function faixasDeJornada(trechos, { faixasKm, faixasHora, chaoKm = null } = {}) {
  const porPeriodo = Object.fromEntries(PERIODOS.map((p) => [p.id, { km: [], hora: [] }]));
  for (const t of trechos || []) {
    const balde = porPeriodo[t.periodo];
    if (!balde) continue;
    if (t.reaisPorKm != null) balde.km.push(t.reaisPorKm);
    if (t.reaisPorHora != null) balde.hora.push(t.reaisPorHora);
  }

  const semente = (base, id) => ({ ...(base?.[id] ?? base ?? {}), n: 0, medida: false });

  return Object.fromEntries(
    PERIODOS.map((p) => [
      p.id,
      {
        km: faixaDe(porPeriodo[p.id].km, { minimo: MINIMO_TRECHOS, chao: chaoKm }) ?? semente(faixasKm, p.id),
        hora: faixaDe(porPeriodo[p.id].hora, { minimo: MINIMO_TRECHOS }) ?? semente(faixasHora, p.id),
      },
    ])
  );
}

/* ------------------------------------------------ referência de aceite */

/**
 * A partir de quanto uma corrida ofertada vale a pena, por período.
 *
 * Escala de CORRIDA: sai do recibo da plataforma, que traz km e duração
 * exatos. É o número que responde "aceito ou recuso" — e é quase o dobro do
 * R$/km de jornada, porque não carrega o deslocamento vazio.
 */
export function referenciaDeAceite(corridas) {
  const porPeriodo = Object.fromEntries(PERIODOS.map((p) => [p.id, { km: [], hora: [], n: 0 }]));

  for (const c of M.corridasValidas(corridas || [])) {
    const balde = porPeriodo[M.periodoDe(c.timestamp)];
    if (!balde) continue;
    balde.n += 1;
    if (c.km > 0 && c.valorBruto > 0) balde.km.push(c.valorBruto / c.km);
    if (c.duracaoMin > 0 && c.valorBruto > 0) balde.hora.push((c.valorBruto / c.duracaoMin) * 60);
  }

  return Object.fromEntries(
    PERIODOS.map((p) => [
      p.id,
      {
        n: porPeriodo[p.id].n,
        km: faixaDe(porPeriodo[p.id].km, { minimo: MINIMO_CORRIDAS }),
        hora: faixaDe(porPeriodo[p.id].hora, { minimo: MINIMO_CORRIDAS }),
      },
    ])
  );
}

/** O período de um instante, com nome — para a tela dizer de qual faixa fala. */
export function periodoAgora(agora = Date.now()) {
  const id = M.periodoDe(agora);
  return PERIODOS.find((p) => p.id === id) || PERIODOS[0];
}
