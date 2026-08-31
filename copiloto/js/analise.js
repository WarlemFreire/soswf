// analise.js — os cálculos da tela de Análise. Puros e testáveis no node.
//
// Cada função declara de onde vem o dado, porque as duas fontes têm precisões
// muito diferentes:
//
//  - CORRIDAS: hora, valor, km e bairro vêm do recibo da plataforma, então são
//    exatos mesmo quando lançados horas depois;
//  - REGISTROS: o carimbo é de quando o motorista conseguiu uma janela para
//    abrir o app, não de quando o dinheiro entrou. Servem para o dia e para o
//    trecho, e só aproximam a hora.

import * as M from "./metrics.js";

export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* ------------------------------------------------------- do uso no app */

/** Rendimento por dia da semana. Vem dos dias fechados — preciso. */
export function porDiaDaSemana(dias) {
  const baldes = DIAS_SEMANA.map((nome, indice) => ({
    indice,
    nome,
    dias: 0,
    bruto: 0,
    msAtivo: 0,
    comTempo: 0,
  }));

  for (const dia of dias || []) {
    const b = baldes[new Date(dia.inicio).getDay()];
    b.dias += 1;
    b.bruto += dia.saldo;
    if (dia.msAtivo != null) {
      b.msAtivo += dia.msAtivo;
      b.comTempo += 1;
    }
  }

  return baldes.map((b) => ({
    ...b,
    brutoMedio: b.dias ? b.bruto / b.dias : null,
    reaisPorHora: b.msAtivo > 0 ? b.bruto / (b.msAtivo / M.HORA) : null,
  }));
}

/**
 * Rendimento por hora a partir dos trechos entre checkpoints.
 *
 * O trecho tem hora de início, de fim e valor, mas não diz em que minuto o
 * dinheiro entrou. Espalhamos o valor proporcionalmente pelas horas que ele
 * cobre. É aproximado e BORRA: um trecho de 20h às 23h com o ganho concentrado
 * às 22h achata a hora boa e levanta as fracas. Serve para tendência, não para
 * achar a janela exata — para isso, corrida a corrida.
 */
export function porHoraDosTrechos(jornadas, registros) {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, valor: 0, ms: 0, trechos: 0 }));

  for (const jornada of jornadas || []) {
    const doDia = (registros || []).filter((r) => r.jornadaId === jornada.id);
    const validos = M.registrosValidos(doDia);
    const eventos = M.eventosDoDia([jornada], doDia);

    let anterior = jornada.horaInicio;
    for (const r of validos) {
      const valor = M.saldoEm(eventos, r.timestamp) - M.saldoEm(eventos, anterior);
      espalhar(horas, anterior, r.timestamp, valor);
      anterior = r.timestamp;
    }
  }

  return horas.map((h) => ({
    ...h,
    horas: h.ms / M.HORA,
    reaisPorHora: h.ms > 0 ? h.valor / (h.ms / M.HORA) : null,
  }));
}

/** Reparte um valor pelas horas de relógio que o intervalo atravessa. */
function espalhar(horas, inicio, fim, valor) {
  const total = fim - inicio;
  if (!(total > 0)) return;

  let cursor = inicio;
  while (cursor < fim) {
    const d = new Date(cursor);
    const fimDaHora = new Date(d).setMinutes(60, 0, 0);
    const pedaco = Math.min(fimDaHora, fim) - cursor;
    const balde = horas[d.getHours()];
    balde.valor += valor * (pedaco / total);
    balde.ms += pedaco;
    balde.trechos += 1;
    cursor += pedaco;
  }
}

/** Quanto se perdeu parado, por motivo. */
export function porMotivoDePausa(dias) {
  const motivos = new Map();
  for (const dia of dias || []) {
    for (const jornada of dia.jornadas || []) {
      for (const pausa of jornada.pausas || []) {
        if (!pausa.horaFim) continue;
        const atual = motivos.get(pausa.motivo) || { motivo: pausa.motivo, ms: 0, n: 0 };
        atual.ms += pausa.horaFim - pausa.horaInicio;
        atual.n += 1;
        motivos.set(pausa.motivo, atual);
      }
    }
  }
  return [...motivos.values()].sort((a, b) => b.ms - a.ms);
}

/* -------------------------------------------------- das corridas lançadas */

export function porFaixaHoraria(corridas) {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, n: 0, valor: 0, km: 0, min: 0 }));
  for (const c of corridas || []) {
    const b = horas[new Date(c.timestamp).getHours()];
    b.n += 1;
    b.valor += c.valorBruto || 0;
    b.km += c.km || 0;
    b.min += c.duracaoMin || 0;
  }
  return horas.map((h) => ({
    ...h,
    reaisPorKm: h.km > 0 ? h.valor / h.km : null,
    ticket: h.n ? h.valor / h.n : null,
  }));
}

/** Matriz 7×24 de faturamento — a base do heatmap. */
export function heatmapHoraDia(corridas) {
  const matriz = DIAS_SEMANA.map((nome, dia) =>
    Array.from({ length: 24 }, (_, hora) => ({ dia, hora, nome, n: 0, valor: 0, km: 0 }))
  );
  for (const c of corridas || []) {
    const d = new Date(c.timestamp);
    const celula = matriz[d.getDay()][d.getHours()];
    celula.n += 1;
    celula.valor += c.valorBruto || 0;
    celula.km += c.km || 0;
  }
  return matriz;
}

export function porBairro(corridas, { minimo = 2 } = {}) {
  const bairros = new Map();
  for (const c of corridas || []) {
    const nome = (c.bairroOrigem || "").trim();
    if (!nome || nome === "?") continue;
    const atual = bairros.get(nome) || { nome, n: 0, valor: 0, km: 0 };
    atual.n += 1;
    atual.valor += c.valorBruto || 0;
    atual.km += c.km || 0;
    bairros.set(nome, atual);
  }
  return [...bairros.values()]
    .filter((b) => b.n >= minimo)
    .map((b) => ({ ...b, reaisPorKm: b.km > 0 ? b.valor / b.km : null, ticket: b.valor / b.n }))
    .sort((a, b) => b.valor - a.valor);
}

/** "Corrida longa compensa?" — comparação acima e abaixo de um corte de km. */
export function longaVsCurta(corridas, limiteKm = 5) {
  const grupo = (lista, nome) => {
    const valor = lista.reduce((s, c) => s + (c.valorBruto || 0), 0);
    const km = lista.reduce((s, c) => s + (c.km || 0), 0);
    const min = lista.reduce((s, c) => s + (c.duracaoMin || 0), 0);
    return {
      nome,
      n: lista.length,
      valor,
      km,
      reaisPorKm: km > 0 ? valor / km : null,
      // Só o tempo dentro da corrida: não inclui ir buscar o passageiro, o que
      // favorece as curtas. A ressalva vale ser dita junto do número.
      reaisPorHora: min > 0 ? (valor / min) * 60 : null,
      ticket: lista.length ? valor / lista.length : null,
    };
  };
  const comKm = (corridas || []).filter((c) => c.km > 0);
  return {
    limiteKm,
    longa: grupo(comKm.filter((c) => c.km >= limiteKm), `≥ ${limiteKm} km`),
    curta: grupo(comKm.filter((c) => c.km < limiteKm), `< ${limiteKm} km`),
  };
}

export function impactoDinamico(corridas) {
  const comKm = (corridas || []).filter((c) => c.km > 0);
  const com = comKm.filter((c) => (c.valorDinamico || 0) > 0);
  const sem = comKm.filter((c) => !(c.valorDinamico > 0));
  const resumo = (lista) => {
    const valor = lista.reduce((s, c) => s + c.valorBruto, 0);
    const km = lista.reduce((s, c) => s + c.km, 0);
    return {
      n: lista.length,
      valor,
      reaisPorKm: km > 0 ? valor / km : null,
      ticket: lista.length ? valor / lista.length : null,
    };
  };
  const bruto = (corridas || []).reduce((s, c) => s + (c.valorBruto || 0), 0);
  const dinamico = (corridas || []).reduce((s, c) => s + (c.valorDinamico || 0), 0);
  return {
    fatia: bruto > 0 ? dinamico / bruto : null,
    dinamico,
    bruto,
    com: resumo(com),
    sem: resumo(sem),
  };
}
