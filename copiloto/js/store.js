// store.js — estado da jornada em memoria + as acoes que gravam no IndexedDB.
// As telas leem daqui e se inscrevem em `assinar` para redesenhar.

import { db, novoId } from "./db.js";
import { cfg, configAtual } from "./config.js";
import * as M from "./metrics.js";
import { RastreadorKm, manterTelaLigada, liberarTela } from "./geo.js";

const estado = {
  jornada: null,
  registros: [],
  pausas: [],
  gpsAcum: null,
  posicao: null,
  gpsAtivo: false,
  gpsErro: null,
};

const ouvintes = new Set();
export const rastreador = new RastreadorKm({ aoAtualizar: (km) => aoGps(km) });

export function assinar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function notificar() {
  for (const fn of ouvintes) fn(estado);
}

export function snapshot() {
  return estado;
}

export function jornadaAtiva() {
  return estado.jornada && !estado.jornada.horaFim ? estado.jornada : null;
}

function aoGps(km) {
  estado.gpsAcum = km;
  estado.posicao = rastreador.posicaoAtual();
  estado.gpsAtivo = rastreador.ativo;
  estado.gpsErro = rastreador.erro;
  notificar();
}

/* ------------------------------------------------------------ carregamento */

export async function carregarJornadaAberta() {
  const jornadas = await db.porIndice("jornadas", "status", "aberta");
  const aberta = jornadas.sort((a, b) => b.horaInicio - a.horaInicio)[0] || null;
  estado.jornada = aberta;
  if (aberta) {
    estado.registros = await db.porIndice("registros", "jornadaId", aberta.id);
    estado.pausas = await db.porIndice("pausas", "jornadaId", aberta.id);
    // A quilometragem de GPS acumulada morre quando o app é fechado; retomamos
    // do ultimo valor gravado para nao perder o trecho ja rodado.
    estado.gpsAcum = ultimoGpsConhecido(aberta, estado.registros);
    if (cfg("usarGps")) iniciarGps();
    if (cfg("manterTelaLigada")) manterTelaLigada();
  } else {
    estado.registros = [];
    estado.pausas = [];
    estado.gpsAcum = null;
  }
  notificar();
  return aberta;
}

function ultimoGpsConhecido(jornada, registros) {
  let maior = jornada.gpsInicio ?? 0;
  for (const r of registros) if ((r.gpsAcum ?? 0) > maior) maior = r.gpsAcum;
  return maior;
}

function iniciarGps() {
  rastreador.iniciar(estado.gpsAcum ?? 0);
  estado.gpsAtivo = rastreador.ativo;
}

/* -------------------------------------------------------------- metricas */

export function metricas(agora = Date.now()) {
  if (!estado.jornada) return null;
  return M.metricasAoVivo({
    jornada: estado.jornada,
    registros: estado.registros,
    pausas: estado.pausas,
    gpsAcum: estado.gpsAcum,
    config: configAtual(),
    agora,
  });
}

export function ultimoOdometro() {
  const comOdometro = M.registrosValidos(estado.registros).filter((r) => r.odometro != null);
  if (comOdometro.length) return comOdometro[comOdometro.length - 1].odometro;
  return estado.jornada?.odometroInicio ?? null;
}

/** Odômetro provável agora: última âncora + o que o GPS andou desde então. */
export function odometroSugerido() {
  const base = ultimoOdometro();
  if (base == null) return null;
  const km = M.kmPercorrido(estado.jornada, estado.registros, estado.gpsAcum);
  const confirmado = base - (estado.jornada?.odometroInicio ?? base);
  const extra = Math.max(0, km - confirmado);
  return Math.round(base + extra);
}

export function saldoDaFonte(id) {
  const fontes = M.saldoPorFonte(M.registrosValidos(estado.registros));
  return fontes[id] || { valor: 0, visto: null };
}

/* ---------------------------------------------------------------- jornada */

export async function abrirJornada({ odometroInicio, metas }) {
  const agora = Date.now();
  const jornada = {
    id: novoId(),
    data: M.chaveData(agora),
    horaInicio: agora,
    horaFim: null,
    odometroInicio: Number(odometroInicio),
    odometroFim: null,
    metaMinima: metas?.minima ?? cfg("metaMinima"),
    metaIdeal: metas?.ideal ?? cfg("metaIdeal"),
    metaOtima: metas?.otima ?? cfg("metaOtima"),
    observacoes: "",
    gpsInicio: 0,
    gpsFim: null,
    status: "aberta",
    criadaEm: agora,
  };
  await db.put("jornadas", jornada);
  estado.jornada = jornada;
  estado.registros = [];
  estado.pausas = [];
  estado.gpsAcum = 0;
  if (cfg("usarGps")) iniciarGps();
  if (cfg("manterTelaLigada")) manterTelaLigada();
  notificar();
  return jornada;
}

export async function fecharJornada({ odometroFim, observacoes } = {}) {
  const jornada = jornadaAtiva();
  if (!jornada) return null;

  const pausa = M.pausaAberta(estado.pausas);
  if (pausa) await encerrarPausa();

  const gpsFim = estado.gpsAcum ?? 0;
  rastreador.parar();
  await liberarTela();

  const fechada = {
    ...jornada,
    horaFim: Date.now(),
    odometroFim: odometroFim != null ? Number(odometroFim) : null,
    observacoes: observacoes ?? jornada.observacoes ?? "",
    gpsFim,
    status: "fechada",
  };
  await db.put("jornadas", fechada);
  estado.jornada = fechada;
  estado.gpsAtivo = false;
  notificar();
  return fechada;
}

export async function reabrirJornada(id) {
  const jornada = await db.get("jornadas", id);
  if (!jornada) return null;
  const reaberta = { ...jornada, horaFim: null, odometroFim: null, status: "aberta" };
  await db.put("jornadas", reaberta);
  await carregarJornadaAberta();
  return reaberta;
}

/* --------------------------------------------------------------- registro */

/**
 * Grava um checkpoint. `saldos` é esparso de proposito: so as plataformas que
 * o motorista tocou entram, e as demais mantem o ultimo valor conhecido.
 */
export async function registrar({ saldos, avulso, odometro, timestamp, tipo = "checkpoint" }) {
  const jornada = jornadaAtiva();
  if (!jornada) return null;

  const registro = {
    id: novoId(),
    jornadaId: jornada.id,
    timestamp: timestamp ?? Date.now(),
    saldos: limparSaldos(saldos),
    odometro: odometro != null && odometro !== "" ? Number(odometro) : null,
    gpsAcum: estado.gpsAcum,
    posicao: estado.posicao,
    tipo,
    desfeito: false,
    criadoEm: Date.now(),
  };
  if (avulso && avulso.valor > 0) {
    registro.avulso = { valor: Number(avulso.valor), tipo: avulso.tipo || "outro" };
  }

  await db.put("registros", registro);
  estado.registros = [...estado.registros, registro];
  notificar();
  return registro;
}

function limparSaldos(saldos) {
  const saida = {};
  for (const [id, valor] of Object.entries(saldos || {})) {
    if (valor == null || valor === "") continue;
    const numero = Number(valor);
    if (Number.isFinite(numero)) saida[id] = numero;
  }
  return saida;
}

/** Desfazer = marcar como desfeito. Mantemos a linha para auditoria depois. */
export async function desfazerRegistro(id) {
  const registro = estado.registros.find((r) => r.id === id);
  if (!registro) return;
  const marcado = { ...registro, desfeito: true, desfeitoEm: Date.now() };
  await db.put("registros", marcado);
  estado.registros = estado.registros.map((r) => (r.id === id ? marcado : r));
  notificar();
}

export function trechoAtual() {
  const jornada = estado.jornada;
  if (!jornada) return null;
  return M.ultimoTrecho(jornada, estado.registros, estado.pausas);
}

/**
 * Diferença que o registro provocaria no saldo total. Usado para detectar
 * queda de saldo (estorno) ou valor digitado no chip errado antes de gravar.
 */
export function deltaSimulado({ saldos, avulso }) {
  const validos = M.registrosValidos(estado.registros);
  const atual = M.saldoTotal(validos);
  const simulado = M.saldoTotal([
    ...validos,
    { id: "__sim__", timestamp: Date.now() + 1, saldos: limparSaldos(saldos), avulso },
  ]);
  return simulado - atual;
}

/* ------------------------------------------------------------------ pausa */

export async function iniciarPausa(motivo) {
  const jornada = jornadaAtiva();
  if (!jornada || M.pausaAberta(estado.pausas)) return null;
  const pausa = {
    id: novoId(),
    jornadaId: jornada.id,
    horaInicio: Date.now(),
    horaFim: null,
    motivo,
  };
  await db.put("pausas", pausa);
  estado.pausas = [...estado.pausas, pausa];
  notificar();
  return pausa;
}

export async function encerrarPausa() {
  const aberta = M.pausaAberta(estado.pausas);
  if (!aberta) return null;
  const fechada = { ...aberta, horaFim: Date.now() };
  await db.put("pausas", fechada);
  estado.pausas = estado.pausas.map((p) => (p.id === aberta.id ? fechada : p));
  notificar();
  return fechada;
}

export async function cancelarPausa(id) {
  await db.remover("pausas", id);
  estado.pausas = estado.pausas.filter((p) => p.id !== id);
  notificar();
}

export function pausaEmCurso() {
  return M.pausaAberta(estado.pausas);
}

/* -------------------------------------------------------------- historico */

export async function historico() {
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const pausas = await db.todos("pausas");

  const porJornada = (lista, id) => lista.filter((x) => x.jornadaId === id);

  return jornadas
    .sort((a, b) => b.horaInicio - a.horaInicio)
    .map((j) => {
      const rs = M.registrosValidos(porJornada(registros, j.id));
      const ps = porJornada(pausas, j.id);
      const fim = j.horaFim ?? Date.now();
      const saldo = M.saldoTotal(rs);
      const km = M.kmPercorrido(j, rs, j.gpsFim ?? null);
      const ativo = M.msAtivo(j, ps, fim);
      return {
        jornada: j,
        registros: rs,
        pausas: ps,
        saldo,
        km,
        msAtivo: ativo,
        msRua: M.msRua(j, fim),
        msPausado: M.msPausado(ps, fim),
        reaisPorHora: M.reaisPorHora(saldo, ativo),
        reaisPorKm: M.reaisPorKm(saldo, km),
        liquido: M.liquidoEstimado(saldo, km, configAtual()),
        fontes: M.saldoPorFonte(rs),
      };
    });
}

/** Média dos últimos N dias fechados, para comparar no fechamento. */
export function media(resumos, dias, campo) {
  const corte = Date.now() - dias * 86400000;
  const alvo = resumos.filter(
    (r) => r.jornada.status === "fechada" && r.jornada.horaInicio >= corte && r[campo] != null
  );
  if (!alvo.length) return null;
  return alvo.reduce((soma, r) => soma + r[campo], 0) / alvo.length;
}
