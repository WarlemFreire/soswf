// ofensiva.js — a corrente de dias trabalhados. Puro e testavel no node.
//
// Sobrou da gamificacao que saiu: medalhas, patentes, XP e moedas viraram
// enfeite que nao mudava decisao nenhuma no volante. A ofensiva ficou porque
// ela responde uma pergunta real -- "estou mantendo o ritmo?" -- e porque
// tolera folga, o que a torna a unica peca do conjunto que nao empurrava
// ninguem a dirigir cansado.

import * as M from "./metrics.js";

const DIA_MS = 86400000;

/** Folga tolerada sem quebrar a ofensiva. Trabalhar 5 e descansar 2 mantém. */
export const FOLGA_MAXIMA = 2;

/**
 * Ofensiva no estilo Duolingo, mas sem obrigar a semana inteira: a corrente só
 * quebra depois de mais de dois dias seguidos parado.
 */
export function ofensiva(dias, hoje = Date.now()) {
  const datas = [...new Set((dias || []).map((d) => d.data))].sort();
  if (!datas.length) {
    return {
      atual: 0,
      recorde: 0,
      folgasRestantes: FOLGA_MAXIMA,
      ultimoDia: null,
      paradoHa: null,
      viva: false,
      trabalhouHoje: false,
      diasNaCorrente: [],
    };
  }

  const emDias = (a, b) => Math.round((meiaNoite(b) - meiaNoite(a)) / DIA_MS);

  // Corta a linha do tempo onde o intervalo passou da folga tolerada.
  const correntes = [[datas[0]]];
  for (let i = 1; i < datas.length; i++) {
    const salto = emDias(datas[i - 1], datas[i]);
    if (salto - 1 > FOLGA_MAXIMA) correntes.push([datas[i]]);
    else correntes.at(-1).push(datas[i]);
  }

  const recorde = Math.max(...correntes.map((c) => c.length));
  const ultima = correntes.at(-1);
  const ultimoDia = ultima.at(-1);
  const paradoHa = emDias(ultimoDia, M.chaveData(hoje));

  // A corrente segue viva enquanto a folga nao estourou.
  const viva = paradoHa <= 0 || paradoHa - 1 <= FOLGA_MAXIMA;
  return {
    atual: viva ? ultima.length : 0,
    recorde,
    ultimoDia,
    paradoHa,
    viva,
    trabalhouHoje: paradoHa === 0,
    folgasRestantes: Math.max(0, FOLGA_MAXIMA - Math.max(0, paradoHa - 1)),
    diasNaCorrente: viva ? ultima : [],
  };
}

function meiaNoite(dataIso) {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getTime();
}
