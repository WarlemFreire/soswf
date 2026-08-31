// progresso.js — nível, XP e moedas. Puro, derivado, sem estado próprio.
//
// Nada disso é gravado no banco: XP e moedas são recalculados dos mesmos
// eventos que geram as medalhas. Assim não existe a classe de bug em que o
// saldo de XP e a lista de conquistas discordam — só há uma verdade.

import { XP_POR_PATENTE } from "./conquistas.js";

/** Cada dia de jornada rendendo XP faz o nível subir mesmo em dia fraco. */
export const XP_DIA = 50;
export const XP_META = { minima: 30, ideal: 60, otima: 120 };
/** Paga o RECORDE de ofensiva, nunca a atual: nível conquistado não desce. */
export const XP_POR_DIA_DE_OFENSIVA = 20;

export const MOEDA_POR_MISSAO = 10;
export const MOEDA_POR_DIA = 5;

/** Passo da curva de nível: o nível N custa PASSO × N de XP. */
const PASSO = 250;

export function xpDetalhado(avaliadas, est) {
  const missoes = (avaliadas || []).filter((m) => m.conquistada);
  const deMissoes = missoes.reduce((soma, m) => soma + (m.xp || XP_POR_PATENTE[0]), 0);
  const deDias = (est.dias || 0) * XP_DIA;
  const deMetas =
    (est.metas?.minima || 0) * XP_META.minima +
    (est.metas?.ideal || 0) * XP_META.ideal +
    (est.metas?.otima || 0) * XP_META.otima;
  const deOfensiva = (est.ofensivaRecorde || 0) * XP_POR_DIA_DE_OFENSIVA;

  return {
    missoes: deMissoes,
    dias: deDias,
    metas: deMetas,
    ofensiva: deOfensiva,
    total: deMissoes + deDias + deMetas + deOfensiva,
    quantasMissoes: missoes.length,
  };
}

/**
 * Em que nível o XP põe o motorista, e quanto falta para o próximo. A curva é
 * triangular: subir fica mais caro, mas nunca impossível.
 */
export function nivelDe(xp) {
  // Math.max(0, NaN) é NaN: sem o teste de finito, um XP corrompido viraria um
  // nível NaN na barra de cima em vez de cair para o nível 1.
  const bruto = Number(xp);
  const total = Number.isFinite(bruto) ? Math.max(0, Math.floor(bruto)) : 0;
  let nivel = 1;
  let base = 0;
  let custo = PASSO;
  while (base + custo <= total) {
    base += custo;
    nivel += 1;
    custo = PASSO * nivel;
  }
  return {
    nivel,
    xp: total,
    base,
    proximo: base + custo,
    faltam: base + custo - total,
    noNivel: total - base,
    custo,
    progresso: custo > 0 ? (total - base) / custo : 0,
  };
}

export function moedasDe(avaliadas, est) {
  const missoes = (avaliadas || []).filter((m) => m.conquistada).length;
  return missoes * MOEDA_POR_MISSAO + (est.dias || 0) * MOEDA_POR_DIA;
}

/** Tudo que a barra de cima e a tela de perfil precisam, de uma vez só. */
export function progresso(avaliadas, est) {
  const xp = xpDetalhado(avaliadas, est);
  return { xp, nivel: nivelDe(xp.total), moedas: moedasDe(avaliadas, est) };
}

export function formatarXp(valor) {
  return Math.round(valor).toLocaleString("pt-BR");
}
