// metrics.js — o "cerebro" do app. Tudo aqui é deterministico e puro: recebe
// dados, devolve numeros. Nenhum acesso a DOM, DB ou rede, para que possa ser
// testado direto no node (ver test/metrics.test.mjs).

import { PERIODOS, PLATAFORMAS } from "./config.js";

export const MINUTO = 60000;
export const HORA = 3600000;

/* ---------------------------------------------------------------- periodos */

export function periodoDe(quando) {
  const h = new Date(quando).getHours();
  for (const p of PERIODOS) {
    if (p.inicio < p.fim) {
      if (h >= p.inicio && h < p.fim) return p.id;
    } else if (h >= p.inicio || h < p.fim) {
      // faixa que cruza a meia-noite (pico: 22h–02h)
      return p.id;
    }
  }
  return "madrugada";
}

export function faixaKmDe(quando, faixasKm) {
  return faixasKm[periodoDe(quando)] || faixasKm.tarde;
}

/* ------------------------------------------------------------------ saldos */

/**
 * Checkpoint parcial: cada plataforma guarda seu proprio ultimo valor
 * conhecido. O motorista atualiza so a que mexeu — os outros valores
 * permanecem validos. Avulsos (frete/particular) sao incrementos, nao saldos,
 * entao somam em vez de substituir.
 */
export function saldoPorFonte(registros) {
  const fontes = {};
  for (const p of PLATAFORMAS) fontes[p.id] = { valor: 0, visto: null };
  fontes.avulso = { valor: 0, visto: null };

  for (const r of ordenados(registros)) {
    if (r.desfeito) continue;
    for (const [id, valor] of Object.entries(r.saldos || {})) {
      if (!(id in fontes) || valor == null) continue;
      fontes[id] = { valor: Number(valor), visto: r.timestamp };
    }
    if (r.avulso && r.avulso.valor != null) {
      fontes.avulso = {
        valor: fontes.avulso.valor + Number(r.avulso.valor),
        visto: r.timestamp,
      };
    }
  }
  return fontes;
}

export function saldoTotal(registros) {
  const fontes = saldoPorFonte(registros);
  return Object.values(fontes).reduce((soma, f) => soma + f.valor, 0);
}

/** Saldo total considerando apenas registros até `ate` (inclusive). */
export function saldoAte(registros, ate) {
  return saldoTotal(registros.filter((r) => r.timestamp <= ate));
}

function ordenados(registros) {
  return [...(registros || [])].sort((a, b) => a.timestamp - b.timestamp);
}

export function registrosValidos(registros) {
  return ordenados(registros).filter((r) => !r.desfeito);
}

/* ------------------------------------------------------------------- tempo */

export function msPausado(pausas, agora = Date.now()) {
  let total = 0;
  for (const p of pausas || []) {
    const fim = p.horaFim ?? agora;
    total += Math.max(0, fim - p.horaInicio);
  }
  return total;
}

export function pausaAberta(pausas) {
  return (pausas || []).find((p) => !p.horaFim) || null;
}

export function msRua(jornada, agora = Date.now()) {
  if (!jornada) return 0;
  const fim = jornada.horaFim ?? agora;
  return Math.max(0, fim - jornada.horaInicio);
}

/** Tempo de rua menos as pausas — é o denominador do R$/hora. */
export function msAtivo(jornada, pausas, agora = Date.now()) {
  return Math.max(0, msRua(jornada, agora) - msPausado(pausas, agora));
}

/* ---------------------------------------------------------------------- km */

/**
 * O km vem de duas fontes que se corrigem:
 *  - odometro do painel, digitado na abertura/fechamento e opcionalmente num
 *    checkpoint. É exato, mas caro de digitar.
 *  - GPS, que acumula sozinho mas escorrega alguns por cento.
 *
 * Usamos o odometro mais recente como ancora e somamos o GPS percorrido de lá
 * pra cá. Sem GPS, o km só avança quando um odometro é digitado — degradação
 * limpa, sem numero inventado.
 */
export function kmPercorrido(jornada, registros, gpsAcumAgora = null) {
  if (!jornada || jornada.odometroInicio == null) return 0;

  let ancoraOdometro = jornada.odometroInicio;
  let ancoraGps = jornada.gpsInicio ?? 0;

  for (const r of registrosValidos(registros)) {
    if (r.odometro != null) {
      ancoraOdometro = r.odometro;
      ancoraGps = r.gpsAcum ?? ancoraGps;
    }
  }
  if (jornada.odometroFim != null) ancoraOdometro = jornada.odometroFim;

  const base = Math.max(0, ancoraOdometro - jornada.odometroInicio);
  if (jornada.odometroFim != null || gpsAcumAgora == null) return base;
  return base + Math.max(0, gpsAcumAgora - ancoraGps);
}

/**
 * Fator de correção do GPS, medido quando a jornada fecha com odometro final.
 * Serve para calibrar as proximas jornadas.
 */
export function fatorCorrecaoGps(jornada) {
  if (!jornada || jornada.odometroFim == null || jornada.odometroInicio == null) return null;
  const real = jornada.odometroFim - jornada.odometroInicio;
  const gps = (jornada.gpsFim ?? 0) - (jornada.gpsInicio ?? 0);
  if (gps <= 0.5 || real <= 0.5) return null;
  return real / gps;
}

/* ---------------------------------------------------------------- metricas */

/** Divide protegendo contra denominadores pequenos demais para ter sentido. */
function taxa(numerador, denominador, minimo) {
  if (!(denominador > minimo)) return null;
  return numerador / denominador;
}

export function reaisPorHora(saldo, msAtivos) {
  return taxa(saldo, msAtivos / HORA, 5 / 60); // ao menos 5 minutos
}

export function reaisPorKm(saldo, km) {
  return taxa(saldo, km, 1); // ao menos 1 km
}

export const NIVEIS = ["abaixo", "piso", "ideal", "otimo"];

/** Classifica um valor contra uma faixa piso/ideal/otimo. */
export function nivel(valor, faixa) {
  if (valor == null || !faixa) return null;
  if (valor < faixa.piso) return "abaixo";
  if (valor < faixa.ideal) return "piso";
  if (valor < faixa.otimo) return "ideal";
  return "otimo";
}

/** Métricas ao vivo da tela principal. */
export function metricasAoVivo({ jornada, registros, pausas, gpsAcum, config, agora = Date.now() }) {
  const validos = registrosValidos(registros);
  const saldo = saldoTotal(validos);
  const ativo = msAtivo(jornada, pausas, agora);
  const rua = msRua(jornada, agora);
  const km = kmPercorrido(jornada, validos, gpsAcum);

  const rh = reaisPorHora(saldo, ativo);
  const rk = reaisPorKm(saldo, km);
  const faixaKm = faixaKmDe(agora, config.faixasKm);

  return {
    saldo,
    fontes: saldoPorFonte(validos),
    msAtivo: ativo,
    msRua: rua,
    msPausado: msPausado(pausas, agora),
    km,
    reaisPorHora: rh,
    reaisPorKm: rk,
    nivelHora: nivel(rh, config.faixaHora),
    nivelKm: nivel(rk, faixaKm),
    faixaKm,
    faixaHora: config.faixaHora,
    periodo: periodoDe(agora),
    emPausa: !!pausaAberta(pausas),
  };
}

/* ------------------------------------------------------------------ trecho */

/**
 * Desempenho entre os dois ultimos checkpoints. É o que o toast mostra logo
 * depois de confirmar um registro.
 */
export function ultimoTrecho(jornada, registros, pausas) {
  const validos = registrosValidos(registros);
  if (validos.length === 0) return null;

  const atual = validos[validos.length - 1];
  const anterior = validos.length > 1 ? validos[validos.length - 2] : null;

  const inicio = anterior ? anterior.timestamp : jornada.horaInicio;
  const saldoInicio = anterior ? saldoAte(validos, anterior.timestamp) : 0;
  const saldoFim = saldoAte(validos, atual.timestamp);

  const bruto = atual.timestamp - inicio;
  const pausado = msPausadoEntre(pausas, inicio, atual.timestamp);
  const ativo = Math.max(0, bruto - pausado);

  const kmInicio = anterior ? kmPercorrido(jornada, cortar(validos, anterior.timestamp), anterior.gpsAcum) : 0;
  const kmFim = kmPercorrido(jornada, cortar(validos, atual.timestamp), atual.gpsAcum);

  const delta = saldoFim - saldoInicio;
  const km = Math.max(0, kmFim - kmInicio);

  return {
    delta,
    msAtivo: ativo,
    km,
    reaisPorHora: reaisPorHora(delta, ativo),
    reaisPorKm: reaisPorKm(delta, km),
    inicio,
    fim: atual.timestamp,
    // Poucos minutos de trecho geram numeros absurdos; a UI usa isso para
    // mostrar o delta sem a taxa.
    confiavel: ativo >= 10 * MINUTO,
  };
}

function cortar(registros, ate) {
  return registros.filter((r) => r.timestamp <= ate);
}

export function msPausadoEntre(pausas, inicio, fim) {
  let total = 0;
  for (const p of pausas || []) {
    const pFim = p.horaFim ?? fim;
    const sobreposicao = Math.min(fim, pFim) - Math.max(inicio, p.horaInicio);
    if (sobreposicao > 0) total += sobreposicao;
  }
  return total;
}

/* ------------------------------------------------------------------- metas */

export function patamares(config) {
  return [
    { id: "minima", nome: "Mínima", alvo: config.metaMinima },
    { id: "ideal", nome: "Ideal", alvo: config.metaIdeal },
    { id: "otima", nome: "Ótima", alvo: config.metaOtima },
  ].sort((a, b) => a.alvo - b.alvo);
}

export function proximoPatamar(saldo, config) {
  return patamares(config).find((p) => saldo < p.alvo) || null;
}

export function patamaresAtingidos(saldo, config) {
  return patamares(config).filter((p) => saldo >= p.alvo);
}

/**
 * "No ritmo atual, meta ideal às 21h40". Extrapola o ritmo medio de R$/hora
 * ativo da jornada. Devolve null quando ainda nao ha ritmo mensuravel.
 */
export function projecao(saldo, msAtivos, alvo, agora = Date.now()) {
  const rh = reaisPorHora(saldo, msAtivos);
  if (rh == null || rh <= 0) return null;
  if (saldo >= alvo) return { quando: agora, jaAtingido: true };
  const faltamMs = ((alvo - saldo) / rh) * HORA;
  return { quando: agora + faltamMs, faltamMs, jaAtingido: false };
}

/* ---------------------------------------------------------------- dinheiro */

export function custosEstimados(km, config) {
  const fatiaGnv = Math.min(100, Math.max(0, config.mixGnvPct)) / 100;
  const porKmGnv = config.kmPorM3 > 0 ? config.precoGnv / config.kmPorM3 : 0;
  const porKmEtanol = config.kmPorLitro > 0 ? config.precoEtanol / config.kmPorLitro : 0;
  const energiaKm = fatiaGnv * porKmGnv + (1 - fatiaGnv) * porKmEtanol;
  const desgasteKm = config.custoDesgasteKm || 0;
  return {
    energiaKm,
    desgasteKm,
    totalKm: energiaKm + desgasteKm,
    energia: energiaKm * km,
    desgaste: desgasteKm * km,
    total: (energiaKm + desgasteKm) * km,
  };
}

export function liquidoEstimado(saldo, km, config) {
  return saldo - custosEstimados(km, config).total;
}

/* --------------------------------------------------------------- formatacao */

export function formatarReais(valor, { comCentavos = true } = {}) {
  if (valor == null || Number.isNaN(valor)) return "—";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: comCentavos ? 2 : 0,
    maximumFractionDigits: comCentavos ? 2 : 0,
  });
}

export function formatarDuracao(ms) {
  if (ms == null || ms < 0) return "—";
  const totalMin = Math.floor(ms / MINUTO);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function formatarHora(quando) {
  if (quando == null) return "—";
  return new Date(quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatarData(quando) {
  return new Date(quando).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function chaveData(quando) {
  const d = new Date(quando);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
