// store.js — estado da jornada em memoria + as acoes que gravam no IndexedDB.
// As telas leem daqui e se inscrevem em `assinar` para redesenhar.

import { db, novoId } from "./db.js";
import { cfg, configAtual, salvarConfig, PLATAFORMAS } from "./config.js";
import * as M from "./metrics.js";
import * as F from "./faixas.js";
import { posicaoAgora, distanciaKm, manterTelaLigada, liberarTela } from "./geo.js";

const estado = {
  jornada: null,
  registros: [],
  corridas: [],
  custos: [],
  abastecimentos: [],
  // Custo de energia por km medido nos abastecimentos reais. Enquanto não há
  // dois abastecimentos, fica null e valem os valores semeados nos Ajustes.
  energiaKm: null,
  // Faixas medidas no histórico: por período, em escala de jornada, mais a
  // referência de aceite em escala de corrida. Recalculadas como o custo de
  // energia — do banco inteiro, quando o banco muda.
  faixas: null,
  aceite: null,
  analiseCombustivel: { suficiente: false, abastecimentos: 0, porKm: null, consumos: {} },
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

/**
 * Carrega tudo ANTES de publicar a jornada no estado.
 *
 * A tela redesenha de segundo em segundo por causa do relógio. Se a jornada
 * entrasse no estado antes da linha do tempo do dia, esse tique pegaria o app
 * no meio do caminho — jornada presente, eventos ainda vazios — e pintaria
 * "R$ 0" com ganho negativo por alguns décimos de segundo. Num app cuja
 * função é dizer quanto o motorista já ganhou, mostrar zero por engano, mesmo
 * que por um instante, é o bastante para ele parar de confiar no número.
 */
export async function carregarJornadaAberta() {
  const jornadas = await db.porIndice("jornadas", "status", "aberta");
  const aberta = jornadas.sort((a, b) => b.horaInicio - a.horaInicio)[0] || null;

  await carregarBairros();
  await carregarCombustivel();
  await carregarFaixas();

  const carga = aberta
    ? {
        registros: await db.porIndice("registros", "jornadaId", aberta.id),
        pausas: await db.porIndice("pausas", "jornadaId", aberta.id),
        corridas: await db.porIndice("corridas", "jornadaId", aberta.id),
        custos: await db.porIndice("custos", "jornadaId", aberta.id),
      }
    : { registros: [], pausas: [], corridas: [], custos: [] };

  const dia = await lerDia(aberta ? aberta.data : M.chaveData(Date.now()));

  // Troca única: daqui em diante nenhuma pintura vê estado pela metade.
  Object.assign(estado, { jornada: aberta }, carga, dia);

  if (aberta && cfg("manterTelaLigada")) manterTelaLigada();
  notificar();
  return aberta;
}

/**
 * Monta a linha do tempo do dia. Chamada em toda mudança que mexe em dinheiro,
 * porque é dela que sai o saldo do dia e o ganho de cada jornada.
 */
/** Lê a linha do tempo do dia sem tocar no estado. */
async function lerDia(data) {
  const dia = data ?? estado.jornada?.data ?? M.chaveData(Date.now());
  const jornadas = (await db.porIndice("jornadas", "data", dia)).sort((a, b) => a.horaInicio - b.horaInicio);

  let registros = [];
  for (const j of jornadas) {
    registros = registros.concat(await db.porIndice("registros", "jornadaId", j.id));
  }
  return { jornadasDoDia: jornadas, eventosDoDia: M.eventosDoDia(jornadas, registros) };
}

async function carregarDia(data) {
  Object.assign(estado, await lerDia(data));
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

/**
 * A configuração com as faixas medidas no lugar das sementes.
 *
 * O cálculo continua sem saber de onde a faixa veio: recebe faixasKm e
 * faixasHora como sempre recebeu, e é aqui, na borda, que a medição do
 * histórico substitui o valor dos Ajustes.
 */
export function configComFaixas() {
  const faixas = faixasEmVigor();
  const por = (grandeza) => Object.fromEntries(Object.entries(faixas).map(([id, f]) => [id, f[grandeza]]));
  return { ...configAtual(), faixasKm: por("km"), faixasHora: por("hora") };
}

export function metricas(agora = Date.now()) {
  if (!estado.jornada) return null;
  return M.metricasAoVivo({
    jornada: estado.jornada,
    eventos: estado.eventosDoDia,
    registros: estado.registros,
    pausas: estado.pausas,
    config: configComFaixas(),
    agora,
  });
}

/** Saldo do dia — o que a tela mostra grande. Tudo que foi registrado hoje. */
export function saldoDoDia() {
  return M.saldoTotal(estado.eventosDoDia);
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

/**
 * Campo em branco é AUSÊNCIA de leitura, nunca zero. Number(null) e Number("")
 * dao 0 e Number(undefined) da NaN; qualquer um dos tres, guardado como se
 * fosse odômetro, faz a jornada parecer ter rodado a quilometragem inteira do
 * carro.
 */
function odometroOuNulo(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

export async function abrirJornada({ odometroInicio, metas, saldoInicial }) {
  const agora = Date.now();
  const jornada = {
    id: novoId(),
    data: M.chaveData(agora),
    horaInicio: agora,
    horaFim: null,
    odometroInicio: odometroOuNulo(odometroInicio),
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
    odometroFim: odometroOuNulo(odometroFim),
    observacoes: observacoes ?? jornada.observacoes ?? "",
    status: "fechada",
  };
  await db.put("jornadas", fechada);
  estado.jornada = fechada;
  // Fechou jornada, os trechos dela entram na conta das faixas.
  await carregarFaixas();
  // O dia continua: recalcula para a tela já oferecer abrir a próxima jornada
  // mostrando quanto rendeu até aqui.
  await carregarDia(fechada.data);
  notificar();
  return fechada;
}

/** Ajusta as metas da jornada em curso, sem mexer no padrão das configurações. */
export async function ajustarMetas({ minima, ideal, otima, horaLimite }) {
  const jornada = jornadaAtiva();
  if (!jornada) return null;
  const atualizada = {
    ...jornada,
    metaMinima: Number(minima),
    metaIdeal: Number(ideal),
    metaOtima: Number(otima),
    // Até que horas esta jornada vai. Algumas noites viram madrugada, e a
    // projeção só faz sentido contra o horário real de parar.
    horaLimite: horaLimite == null ? jornada.horaLimite : Number(horaLimite),
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
  const ajustados = { ...campos };
  for (const chave of ["odometroInicio", "odometroFim"]) {
    if (chave in ajustados) ajustados[chave] = odometroOuNulo(ajustados[chave]);
  }
  const corrigida = { ...jornada, ...ajustados, corrigidaEm: Date.now() };
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
    odometro: odometroOuNulo(odometro),
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
    kmLinhaReta: dados.kmLinhaReta != null ? Number(dados.kmLinhaReta) : null,
    // Encerrada no cronômetro, valor para depois. Fica fora das médias até lá.
    pendente: dados.pendente === true,
    origem: dados.origem || "app",
    criadoEm: Date.now(),
  };

  await db.put("corridas", corrida);
  estado.corridas = [...estado.corridas.filter((c) => c.id !== corrida.id), corrida];
  await carregarBairros();
  await carregarFaixas();
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

/**
 * Recalcula as faixas de referência a partir de todo o histórico.
 *
 * Roda junto do carregamento e a cada fechamento de jornada, nao a cada
 * checkpoint: é uma varredura do banco inteiro, e uma faixa que muda no meio
 * do turno faria o medidor mudar de cor sem o motorista ter feito nada.
 */
async function carregarFaixas() {
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const corridas = await db.todos("corridas");
  const config = configAtual();

  estado.faixas = F.faixasDeJornada(F.trechosDe(jornadas, registros), {
    faixasKm: config.faixasKm,
    faixasHora: config.faixasHora,
    chaoKm: M.custosEstimados(0, config, estado.energiaKm).totalKm,
  });
  estado.aceite = F.referenciaDeAceite(corridas);
}

/** Abaixo de quanto recusar, no período de agora. */
export function pisoDeAceiteAgora(agora = Date.now()) {
  const periodo = F.periodoAgora(agora);
  return {
    periodo,
    ...F.pisoDeAceite({ faixaDaJornada: faixasEmVigor()[periodo.id] }),
    tipicas: estado.aceite?.[periodo.id] ?? null,
  };
}

/** As faixas em vigor: medidas onde há amostra, semente onde não há. */
export function faixasEmVigor() {
  return estado.faixas || F.faixasDeJornada([], { faixasKm: cfg("faixasKm"), faixasHora: cfg("faixasHora") });
}

export function referenciaDeAceite() {
  return estado.aceite;
}

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
    odometro: odometroOuNulo(dados.odometro),
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
