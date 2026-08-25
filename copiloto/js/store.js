// store.js — estado da jornada em memoria + as acoes que gravam no IndexedDB.
// As telas leem daqui e se inscrevem em `assinar` para redesenhar.

import { db, novoId } from "./db.js";
import { cfg, configAtual } from "./config.js";
import * as M from "./metrics.js";
import { RastreadorKm, manterTelaLigada, liberarTela } from "./geo.js";

const estado = {
  jornada: null,
  registros: [],
  corridas: [],
  corridaEmCurso: null,
  bairros: [],
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
  await carregarBairros();
  if (aberta) {
    estado.registros = await db.porIndice("registros", "jornadaId", aberta.id);
    estado.pausas = await db.porIndice("pausas", "jornadaId", aberta.id);
    estado.corridas = await db.porIndice("corridas", "jornadaId", aberta.id);
    // A quilometragem de GPS acumulada morre quando o app é fechado; retomamos
    // do ultimo valor gravado para nao perder o trecho ja rodado.
    estado.gpsAcum = ultimoGpsConhecido(aberta, estado.registros);
    if (cfg("usarGps")) iniciarGps();
    if (cfg("manterTelaLigada")) manterTelaLigada();
  } else {
    estado.registros = [];
    estado.pausas = [];
    estado.corridas = [];
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
  estado.corridas = [];
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

/* --------------------------------------------------------------- corridas */

/**
 * O cronometro de corrida. Com o GPS ligado, dois toques (embarcou / desceu)
 * entregam km e duracao sem digitacao — e, de quebra, o km de deslocamento
 * gasto para chegar ate o passageiro, que é justamente o dado que a planilha
 * nao tem como saber.
 */
export function iniciarCorrida() {
  const jornada = jornadaAtiva();
  if (!jornada || estado.corridaEmCurso) return null;

  const anterior = M.corridasValidas(estado.corridas).at(-1);
  estado.corridaEmCurso = {
    inicio: Date.now(),
    gpsInicio: estado.gpsAcum,
    posicaoOrigem: estado.posicao,
    // Deslocamento = o que rodou entre o fim da corrida anterior e agora.
    kmDeslocamento:
      anterior?.gpsFim != null && estado.gpsAcum != null
        ? Math.max(0, estado.gpsAcum - anterior.gpsFim)
        : null,
    minEspera: anterior?.timestampFim ? Math.round((Date.now() - anterior.timestampFim) / M.MINUTO) : null,
  };
  notificar();
  return estado.corridaEmCurso;
}

export function cancelarCorridaEmCurso() {
  estado.corridaEmCurso = null;
  notificar();
}

export function corridaEmCurso() {
  return estado.corridaEmCurso;
}

/** Fecha o cronômetro e devolve os campos medidos, sem gravar ainda. */
export function medirCorrida() {
  const curso = estado.corridaEmCurso;
  if (!curso) return null;
  const fim = Date.now();
  return {
    ...curso,
    fim,
    duracaoMin: Number(Math.max(0.1, (fim - curso.inicio) / M.MINUTO).toFixed(1)),
    km:
      curso.gpsInicio != null && estado.gpsAcum != null
        ? Number((estado.gpsAcum - curso.gpsInicio).toFixed(2))
        : null,
    gpsFim: estado.gpsAcum,
    posicaoDestino: estado.posicao,
  };
}

export async function salvarCorrida(dados) {
  const jornada = jornadaAtiva();
  const corrida = {
    id: dados.id || novoId(),
    jornadaId: jornada?.id ?? dados.jornadaId ?? null,
    timestamp: dados.timestamp ?? Date.now(),
    timestampFim: dados.timestampFim ?? null,
    plataforma: dados.plataforma || cfg("plataformaPrincipal"),
    valorBruto: Number(dados.valorBruto) || 0,
    valorDinamico: Number(dados.valorDinamico) || 0,
    km: dados.km != null ? Number(dados.km) : null,
    duracaoMin: dados.duracaoMin != null ? Number(dados.duracaoMin) : null,
    bairroOrigem: (dados.bairroOrigem || "").trim(),
    bairroDestino: (dados.bairroDestino || "").trim(),
    tipoCorrida: dados.tipoCorrida || "normal",
    kmDeslocamento: dados.kmDeslocamento != null ? Number(dados.kmDeslocamento) : null,
    minEspera: dados.minEspera != null ? Number(dados.minEspera) : null,
    gpsInicio: dados.gpsInicio ?? null,
    gpsFim: dados.gpsFim ?? null,
    posicaoOrigem: dados.posicaoOrigem ?? null,
    posicaoDestino: dados.posicaoDestino ?? null,
    origem: dados.origem || "app",
    criadoEm: Date.now(),
  };

  await db.put("corridas", corrida);
  estado.corridas = [...estado.corridas.filter((c) => c.id !== corrida.id), corrida];
  estado.corridaEmCurso = null;
  await carregarBairros();
  notificar();
  return corrida;
}

export async function removerCorrida(id) {
  await db.remover("corridas", id);
  estado.corridas = estado.corridas.filter((c) => c.id !== id);
  notificar();
}

export function corridasDoDia() {
  return M.corridasValidas(estado.corridas);
}

/** Confere as corridas lançadas contra o saldo dos checkpoints. */
export function conferencia() {
  return M.conferenciaCorridas(estado.registros, estado.corridas);
}

async function carregarBairros() {
  estado.bairros = M.bairrosUsados(await db.todos("corridas"));
}

export function bairros() {
  return estado.bairros;
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
  const corridas = await db.todos("corridas");

  const porJornada = (lista, id) => lista.filter((x) => x.jornadaId === id);

  return jornadas
    .sort((a, b) => b.horaInicio - a.horaInicio)
    .map((j) => {
      const rs = M.registrosValidos(porJornada(registros, j.id));
      const ps = porJornada(pausas, j.id);
      const cs = M.corridasValidas(porJornada(corridas, j.id));
      const fim = j.horaFim ?? Date.now();
      const importada = j.origem === "planilha";
      const saldo = M.brutoDoDia(rs, cs);
      const km = M.kmPercorrido(j, rs, j.gpsFim ?? null);

      // Num dia importado da planilha, o intervalo entre a primeira e a última
      // corrida nao é jornada trabalhada — usar isso como denominador de R$/h
      // inventaria um numero e ainda contaminaria as medias de 7 e 30 dias.
      // Só vale a hora que o motorista informou na propria planilha.
      const ativo = importada
        ? (j.horasAtivasInformadas > 0 ? j.horasAtivasInformadas * M.HORA : null)
        : M.msAtivo(j, ps, fim);
      return {
        jornada: j,
        registros: rs,
        pausas: ps,
        corridas: cs,
        importada,
        conferencia: M.conferenciaCorridas(rs, cs),
        aproveitamento: M.aproveitamentoKm(cs, km),
        saldo,
        km,
        msAtivo: ativo,
        msRua: importada ? null : M.msRua(j, fim),
        msPausado: importada ? null : M.msPausado(ps, fim),
        reaisPorHora: ativo == null ? null : M.reaisPorHora(saldo, ativo),
        reaisPorKm: M.reaisPorKm(saldo, km),
        // Sem odômetro nao ha km, e sem km nao ha custo — melhor nao mostrar
        // liquido do que mostrar o bruto disfarçado de liquido.
        liquido: km > 0 ? M.liquidoEstimado(saldo, km, configAtual()) : null,
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
