// store.js — estado da jornada em memoria + as acoes que gravam no IndexedDB.
// As telas leem daqui e se inscrevem em `assinar` para redesenhar.

import { db, novoId } from "./db.js";
import { cfg, configAtual, PLATAFORMAS } from "./config.js";
import * as M from "./metrics.js";
import { posicaoAgora, manterTelaLigada, liberarTela } from "./geo.js";

const estado = {
  jornada: null,
  registros: [],
  corridas: [],
  custos: [],
  abastecimentos: [],
  // Custo de energia por km medido nos abastecimentos reais. Enquanto não há
  // dois abastecimentos, fica null e valem os valores semeados nos Ajustes.
  energiaKm: null,
  analiseCombustivel: { suficiente: false, abastecimentos: 0, porKm: null, consumos: {} },
  corridaEmCurso: null,
  bairros: [],
  pausas: [],
  // Linha do tempo do dia inteiro: as declarações de abertura das jornadas de
  // hoje e todos os registros de hoje, em ordem. É a única fonte do dinheiro.
  eventosDoDia: [],
  jornadasDoDia: [],
};

const ouvintes = new Set();

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

/* ------------------------------------------------------------ carregamento */

export async function carregarJornadaAberta() {
  const jornadas = await db.porIndice("jornadas", "status", "aberta");
  const aberta = jornadas.sort((a, b) => b.horaInicio - a.horaInicio)[0] || null;
  estado.jornada = aberta;

  await carregarBairros();
  await carregarCombustivel();
  if (aberta) {
    estado.registros = await db.porIndice("registros", "jornadaId", aberta.id);
    estado.pausas = await db.porIndice("pausas", "jornadaId", aberta.id);
    estado.corridas = await db.porIndice("corridas", "jornadaId", aberta.id);
    estado.custos = await db.porIndice("custos", "jornadaId", aberta.id);
    await carregarDia(aberta.data);
    if (cfg("manterTelaLigada")) manterTelaLigada();
  } else {
    estado.registros = [];
    estado.pausas = [];
    estado.corridas = [];
    estado.custos = [];
    await carregarDia(M.chaveData(Date.now()));
  }
  notificar();
  return aberta;
}

/**
 * Monta a linha do tempo do dia. Chamada em toda mudança que mexe em dinheiro,
 * porque é dela que sai o saldo do dia e o ganho de cada jornada.
 */
async function carregarDia(data) {
  const dia = data ?? estado.jornada?.data ?? M.chaveData(Date.now());
  const jornadas = (await db.porIndice("jornadas", "data", dia)).sort((a, b) => a.horaInicio - b.horaInicio);

  let registros = [];
  for (const j of jornadas) {
    registros = registros.concat(await db.porIndice("registros", "jornadaId", j.id));
  }

  estado.jornadasDoDia = jornadas;
  estado.eventosDoDia = M.eventosDoDia(jornadas, registros);
  return estado.eventosDoDia;
}

/**
 * Onde cada plataforma estava no fim da última jornada de hoje — sugestão de
 * linha de base para a próxima. O motorista só confere o número.
 */
export async function saldoInicialSugerido() {
  await carregarDia(M.chaveData(Date.now()));
  const fontes = M.saldoPorFonte(estado.eventosDoDia);
  const sugestao = {};
  for (const plataforma of PLATAFORMAS) {
    if (fontes[plataforma.id]?.valor > 0) sugestao[plataforma.id] = fontes[plataforma.id].valor;
  }
  return sugestao;
}

/* -------------------------------------------------------------- metricas */

export function metricas(agora = Date.now()) {
  if (!estado.jornada) return null;
  return M.metricasAoVivo({
    jornada: estado.jornada,
    eventos: estado.eventosDoDia,
    registros: estado.registros,
    pausas: estado.pausas,
    config: configAtual(),
    agora,
  });
}

/** Saldo do dia agora — o que a tela mostra grande. */
export function saldoDoDia(agora = Date.now()) {
  return M.saldoEm(estado.eventosDoDia, agora);
}

export function eventosDoDia() {
  return estado.eventosDoDia;
}

export function jornadasDoDia() {
  return estado.jornadasDoDia;
}

export function ultimoOdometro() {
  const comOdometro = M.registrosValidos(estado.registros).filter((r) => r.odometro != null);
  if (comOdometro.length) return comOdometro[comOdometro.length - 1].odometro;
  return estado.jornada?.odometroInicio ?? null;
}

export function saldoDaFonte(id) {
  const fontes = M.saldoPorFonte(estado.eventosDoDia);
  return fontes[id] || { valor: 0, visto: null };
}

/* ---------------------------------------------------------------- jornada */

export async function abrirJornada({ odometroInicio, metas, saldoInicial }) {
  const agora = Date.now();
  const jornada = {
    id: novoId(),
    data: M.chaveData(agora),
    horaInicio: agora,
    horaFim: null,
    odometroInicio: Number(odometroInicio),
    odometroFim: null,
    // Linha de base do dia: a plataforma não zera "ganhos de hoje" quando uma
    // segunda jornada começa.
    saldoInicial: saldoInicial || {},
    metaMinima: metas?.minima ?? cfg("metaMinima"),
    metaIdeal: metas?.ideal ?? cfg("metaIdeal"),
    metaOtima: metas?.otima ?? cfg("metaOtima"),
    observacoes: "",
    status: "aberta",
    criadaEm: agora,
  };
  await db.put("jornadas", jornada);
  estado.jornada = jornada;
  estado.registros = [];
  estado.pausas = [];
  estado.corridas = [];
  estado.custos = [];
  await carregarDia(jornada.data);
  if (cfg("manterTelaLigada")) manterTelaLigada();
  notificar();
  return jornada;
}

export async function fecharJornada({ odometroFim, observacoes } = {}) {
  const jornada = jornadaAtiva();
  if (!jornada) return null;

  if (M.pausaAberta(estado.pausas)) await encerrarPausa();
  await liberarTela();

  const fechada = {
    ...jornada,
    horaFim: Date.now(),
    odometroFim: odometroFim != null ? Number(odometroFim) : null,
    observacoes: observacoes ?? jornada.observacoes ?? "",
    status: "fechada",
  };
  await db.put("jornadas", fechada);
  estado.jornada = fechada;
  // O dia continua: recalcula para a tela já oferecer abrir a próxima jornada
  // mostrando quanto rendeu até aqui.
  await carregarDia(fechada.data);
  notificar();
  return fechada;
}

/** Ajusta as metas da jornada em curso, sem mexer no padrão das configurações. */
export async function ajustarMetas({ minima, ideal, otima }) {
  const jornada = jornadaAtiva();
  if (!jornada) return null;
  const atualizada = {
    ...jornada,
    metaMinima: Number(minima),
    metaIdeal: Number(ideal),
    metaOtima: Number(otima),
  };
  await db.put("jornadas", atualizada);
  estado.jornada = atualizada;
  notificar();
  return atualizada;
}

/**
 * Corrige o dinheiro de uma jornada. O saldo final entra como mais uma leitura
 * na linha do tempo — do mesmo jeito que um checkpoint entraria —, gravada no
 * instante do fechamento. Nada de campo especial: correção é leitura.
 */
export async function corrigirSaldoJornada(jornadaId, saldosFinais) {
  const jornada = await db.get("jornadas", jornadaId);
  if (!jornada) return null;

  const limpos = limparSaldos(saldosFinais);
  const quando = jornada.horaFim ?? Date.now();
  const registros = await db.porIndice("registros", "jornadaId", jornadaId);
  const existente = registros.find((r) => r.tipo === "correcao");

  if (!Object.keys(limpos).length) {
    if (existente) await db.remover("registros", existente.id);
  } else {
    const correcao = {
      ...(existente || {}),
      id: existente?.id || novoId(),
      jornadaId,
      timestamp: quando,
      saldos: limpos,
      odometro: existente?.odometro ?? null,
      posicao: null,
      tipo: "correcao",
      desfeito: false,
      criadoEm: existente?.criadoEm ?? Date.now(),
      corrigidoEm: Date.now(),
    };
    await db.put("registros", correcao);
  }

  if (estado.jornada?.id === jornadaId) {
    estado.registros = await db.porIndice("registros", "jornadaId", jornadaId);
  }
  await carregarDia(jornada.data);
  notificar();
  return db.porIndice("registros", "jornadaId", jornadaId);
}

/**
 * Onde cada plataforma estava no fim de uma jornada, e onde a jornada seguinte
 * do mesmo dia declara sua base. Serve para a tela de correção mostrar os dois
 * lados e avisar quando eles deixam de bater.
 */
export async function contornoDaJornada(jornadaId) {
  const jornada = await db.get("jornadas", jornadaId);
  if (!jornada) return null;

  const doDia = (await db.porIndice("jornadas", "data", jornada.data)).sort(
    (a, b) => a.horaInicio - b.horaInicio
  );
  let registros = [];
  for (const j of doDia) registros = registros.concat(await db.porIndice("registros", "jornadaId", j.id));

  // Mesma janela que o histórico usa, para os dois nunca discordarem.
  const janela = M.janelaDaJornada(doDia, registros, jornada);
  return {
    jornada,
    proxima: janela.proxima,
    fontesFim: janela.fontesFim,
    ganho: janela.ganho,
    saldoDia: M.saldoEm(M.eventosDoDia(doDia, registros), Date.now()),
  };
}

/** Corrige uma jornada já encerrada (odômetro errado, metas, observações). */
export async function corrigirJornada(id, campos) {
  const jornada = await db.get("jornadas", id);
  if (!jornada) return null;
  const corrigida = { ...jornada, ...campos, corrigidaEm: Date.now() };
  await db.put("jornadas", corrigida);
  if (estado.jornada?.id === id) estado.jornada = corrigida;
  notificar();
  return corrigida;
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
    // Só grava odômetro que ele digitou. Nada de âncora inferida.
    odometro: odometro != null && odometro !== "" ? Number(odometro) : null,
    posicao: null,
    tipo,
    desfeito: false,
    criadoEm: Date.now(),
  };

  if (avulso && avulso.valor > 0) {
    registro.avulso = { valor: Number(avulso.valor), tipo: avulso.tipo || "outro" };
  }

  await db.put("registros", registro);
  estado.registros = [...estado.registros, registro];
  await carregarDia(jornada.data);
  notificar();

  // A coordenada vem depois, em segundo plano. O GPS leva segundos para
  // responder e o registro não pode esperar por ele: o toast tem que aparecer
  // no instante do toque, e a zona é enfeite perto disso.
  if (cfg("marcarPosicao")) marcarZona(registro.id);

  return registro;
}

async function marcarZona(id) {
  const posicao = await posicaoAgora();
  if (!posicao) return;
  const registro = estado.registros.find((r) => r.id === id);
  if (!registro) return;
  const comZona = { ...registro, posicao: { lat: posicao.lat, lon: posicao.lon } };
  await db.put("registros", comZona);
  estado.registros = estado.registros.map((r) => (r.id === id ? comZona : r));
  await carregarDia(estado.jornada?.data);
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
  await carregarDia(estado.jornada?.data);
  notificar();
}

export function trechoAtual() {
  const jornada = estado.jornada;
  if (!jornada) return null;
  return M.ultimoTrecho(jornada, estado.registros, estado.pausas, estado.eventosDoDia);
}

/**
 * Diferença que o registro provocaria no saldo total. Usado para detectar
 * queda de saldo (estorno) ou valor digitado no chip errado antes de gravar.
 */
/** Quanto este registro mudaria o saldo do dia, antes de gravar. */
export function deltaSimulado({ saldos, avulso }) {
  const agora = Date.now();
  const atual = M.saldoEm(estado.eventosDoDia, agora);
  const simulado = M.saldoTotal([
    ...estado.eventosDoDia,
    { id: "__sim__", timestamp: agora + 1, saldos: limparSaldos(saldos), avulso },
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
  // Sem rastreio contínuo o cronômetro não mede km — mas duração e espera são
  // relógio de parede, e os dois toques (embarcou / desceu) acontecem com o
  // app em primeiro plano. Esses dois campos continuam saindo de graça.
  estado.corridaEmCurso = {
    inicio: Date.now(),
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
    km: null,
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
  const ganho = M.ganhoDaJornada(estado.eventosDoDia, estado.jornada);
  return M.conferenciaCorridas(estado.registros, estado.corridas, ganho);
}

async function carregarBairros() {
  estado.bairros = M.bairrosUsados(await db.todos("corridas"));
}

export function bairros() {
  return estado.bairros;
}

/* -------------------------------------------------------------- custos */

async function carregarCombustivel() {
  const todos = await db.todos("custos");
  estado.abastecimentos = todos.filter((c) => M.ehCombustivel(c.tipo));
  estado.analiseCombustivel = M.analiseAbastecimentos(todos);
  estado.energiaKm = estado.analiseCombustivel.porKm;
}

/** Custo de energia por km: medido quando dá, semeado enquanto não dá. */
export function energiaKm() {
  return estado.energiaKm;
}

export function analiseCombustivel() {
  return estado.analiseCombustivel;
}

/** Último abastecimento com odômetro — base do tanque em curso. */
export function ultimoAbastecimento() {
  return (
    [...estado.abastecimentos].filter((c) => c.odometro > 0).sort((a, b) => b.odometro - a.odometro)[0] || null
  );
}

export function custosDaJornada() {
  return [...estado.custos].sort((a, b) => a.timestamp - b.timestamp);
}

export async function registrarCusto(dados) {
  const jornada = jornadaAtiva();
  const custo = {
    id: dados.id || novoId(),
    jornadaId: jornada?.id ?? null,
    timestamp: dados.timestamp ?? Date.now(),
    tipo: dados.tipo || "outro",
    valor: Number(dados.valor) || 0,
    litros: dados.litros != null && dados.litros !== "" ? Number(dados.litros) : null,
    odometro: dados.odometro != null && dados.odometro !== "" ? Number(dados.odometro) : null,
    observacao: dados.observacao || "",
    criadoEm: Date.now(),
  };
  await db.put("custos", custo);
  if (custo.jornadaId) estado.custos = [...estado.custos.filter((c) => c.id !== custo.id), custo];
  await carregarCombustivel();
  notificar();
  return custo;
}

export async function removerCusto(id) {
  await db.remover("custos", id);
  estado.custos = estado.custos.filter((c) => c.id !== id);
  await carregarCombustivel();
  notificar();
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
  const custos = await db.todos("custos");
  const config = configAtual();

  const porJornada = (lista, id) => lista.filter((x) => x.jornadaId === id);
  const porData = new Map(jornadas.map((j) => [j.id, j.data]));

  return jornadas
    .sort((a, b) => b.horaInicio - a.horaInicio)
    .map((j) => {
      const rs = M.registrosValidos(porJornada(registros, j.id));
      const ps = porJornada(pausas, j.id);
      const cs = M.corridasValidas(porJornada(corridas, j.id));
      const gastos = porJornada(custos, j.id);
      const fim = j.horaFim ?? Date.now();
      const importada = j.origem === "planilha";

      const janela = M.janelaDaJornada(
        jornadas,
        registros.filter((x) => porData.get(x.jornadaId) === j.data),
        j
      );
      const saldo = janela.eventos.length ? janela.ganho : M.somaCorridas(cs);
      const km = M.kmPercorrido(j, rs);

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
        custos: gastos,
        gastoReal: gastos.reduce((soma, g) => soma + (g.valor || 0), 0),
        importada,
        conferencia: M.conferenciaCorridas(rs, cs, saldo),
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
        liquido: km > 0 ? M.liquidoEstimado(saldo, km, config, estado.energiaKm) : null,
        fontes: M.saldoPorFonte(rs),
      };
    });
}

/**
 * Agrupa as jornadas por dia. Com duas jornadas no mesmo dia, é o dia que a
 * planilha e as médias enxergam — inclusive as Horas Ativas, que somam.
 */
export function agruparPorDia(resumos) {
  const dias = new Map();
  for (const r of resumos) {
    const chave = r.jornada.data;
    if (!dias.has(chave)) {
      dias.set(chave, {
        data: chave,
        jornadas: [],
        saldo: 0,
        km: 0,
        msAtivo: 0,
        temTempo: false,
        corridas: [],
        liquido: 0,
        temLiquido: false,
      });
    }
    const dia = dias.get(chave);
    dia.jornadas.push(r);
    dia.saldo += r.saldo;
    dia.km += r.km;
    dia.corridas.push(...r.corridas);
    if (r.msAtivo != null) {
      dia.msAtivo += r.msAtivo;
      dia.temTempo = true;
    }
    if (r.liquido != null) {
      dia.liquido += r.liquido;
      dia.temLiquido = true;
    }
  }
  return [...dias.values()]
    .map((dia) => ({
      ...dia,
      msAtivo: dia.temTempo ? dia.msAtivo : null,
      liquido: dia.temLiquido ? dia.liquido : null,
      reaisPorHora: dia.temTempo ? M.reaisPorHora(dia.saldo, dia.msAtivo) : null,
      reaisPorKm: M.reaisPorKm(dia.saldo, dia.km),
      inicio: Math.min(...dia.jornadas.map((j) => j.jornada.horaInicio)),
    }))
    .sort((a, b) => b.inicio - a.inicio);
}

/** Média dos últimos N dias, para comparar no fechamento. */
export function media(dias, quantos, campo) {
  const corte = Date.now() - quantos * 86400000;
  const alvo = (dias || []).filter((d) => d.inicio >= corte && d[campo] != null);
  if (!alvo.length) return null;
  return alvo.reduce((soma, d) => soma + d[campo], 0) / alvo.length;
}
