// estrategia.js — os sinais que respondem "o que eu faço diferente".
//
// A DIVISÃO DE TRABALHO É O PONTO DESTE ARQUIVO. Modelo de linguagem não
// aprende entre uma chamada e outra: mandar mais histórico faz ele PARECER que
// aprendeu, e não aprende nada. Então o aprendizado mora aqui, no app:
//
//   AQUI   mede. Quanto tempo parado, que mistura de corrida, onde rendeu
//          mais, o que mudou em relação ao padrão dele. Determinístico,
//          auditável, e sobrevive a trocar de modelo.
//
//   LÁ     narra e propõe. O modelo recebe os sinais já medidos e o placar das
//          sugestões anteriores, e escreve o que fazer.
//
// Sem isso, "aprendizado" seria conversa: o modelo diria que aprendeu e na
// chamada seguinte não lembraria de nada.
//
// O QUE ESTES DADOS NÃO SÃO. Eles descrevem a experiência DELE, não a cidade.
// "Região X rendeu mais" quer dizer "nas vezes em que você esteve na região X,
// rendeu mais" -- e ele só esteve onde escolheu estar. Um lugar ótimo onde ele
// nunca foi não aparece aqui, e dizer que a região X é a melhor da cidade seria
// mentira. O prompt precisa carregar essa ressalva.

import * as M from "./metrics.js";
import * as F from "./faixas.js";

/** Lado da célula do mapa, em graus. ~1,1 km de altura. */
const CELULA = 0.01;

/** Sem este tanto de amostra, um padrão é coincidência. */
export const MINIMO_TRECHOS_REGIAO = 4;
export const MINIMO_DIAS_PADRAO = 3;

/** Acima disto, o trecho foi tempo parado e não trabalho. */
const TRECHO_LONGO_MS = 45 * 60 * 1000;

/* ------------------------------------------------------------- o agora */

/**
 * O que está acontecendo no turno de hoje, comparado ao padrão dele.
 *
 * É a parte que muda a decisão AGORA: estar 40 minutos sem ganhar nada é
 * informação acionável; a média do mês não é.
 */
export function situacaoDoTurno({ jornada, registros, pausas, eventos, agora = Date.now() }) {
  if (!jornada) return null;

  const validos = M.registrosValidos(registros).slice().sort((a, b) => a.timestamp - b.timestamp);
  const ultimo = validos[validos.length - 1];
  const desde = ultimo?.timestamp ?? jornada.horaInicio;

  const msSemGanhar = Math.max(0, agora - desde);
  const pausado = M.msPausadoEntre(pausas, desde, agora);

  return {
    periodo: M.periodoDe(agora),
    horasAbertas: arredondar((agora - jornada.horaInicio) / M.HORA, 2),
    minutosSemGanhar: Math.round(msSemGanhar / 60000),
    // Parado por escolha (pausa) é diferente de parado sem corrida. O primeiro
    // é descanso; o segundo é o sinal de que a praça esfriou.
    minutosEmPausa: Math.round(pausado / 60000),
    minutosOciosos: Math.round(Math.max(0, msSemGanhar - pausado) / 60000),
    ganhoAteAgora: arredondar(M.ganhoDaJornada(eventos, jornada), 2),
    registros: validos.length,
  };
}

/* -------------------------------------------------------- tempo parado */

/**
 * Quanto do turno foi parado sem ganhar, por período do dia.
 *
 * Usa os trechos entre checkpoints: trecho muito longo com ganho pequeno é
 * tempo ocioso, mesmo sem pausa marcada. O motorista não marca pausa quando
 * está esperando corrida -- ele só está esperando.
 */
export function ociosidade(trechos) {
  const porPeriodo = new Map();

  for (const t of trechos || []) {
    const balde = porPeriodo.get(t.periodo) || { periodo: t.periodo, trechos: 0, ms: 0, msOcioso: 0, valor: 0 };
    balde.trechos += 1;
    balde.ms += t.ms;
    balde.valor += t.valor;
    if (t.ms > TRECHO_LONGO_MS) balde.msOcioso += t.ms;
    porPeriodo.set(t.periodo, balde);
  }

  return [...porPeriodo.values()]
    .map((b) => ({
      periodo: b.periodo,
      horas: arredondar(b.ms / M.HORA, 2),
      horasOciosas: arredondar(b.msOcioso / M.HORA, 2),
      fatiaOciosa: b.ms > 0 ? arredondar(b.msOcioso / b.ms, 2) : null,
      reaisPorHora: b.ms > 0 ? arredondar(b.valor / (b.ms / M.HORA), 2) : null,
    }))
    .sort((a, b) => (b.fatiaOciosa ?? 0) - (a.fatiaOciosa ?? 0));
}

/* ----------------------------------------------------------- a mistura */

/**
 * Que tipo de corrida ele está pegando, e quanto cada tipo rende.
 *
 * O corte entre curta e longa sai da MEDIANA dele, não de um número fixo: cinco
 * quilômetros é curto numa capital e longo numa cidade pequena.
 */
export function misturaDeCorridas(corridas) {
  const validas = M.corridasValidas(corridas).filter((c) => c.km > 0 && c.valorBruto > 0);
  if (validas.length < 8) return { suficiente: false, corridas: validas.length };

  const kms = validas.map((c) => c.km).sort((a, b) => a - b);
  const corte = kms[Math.floor(kms.length / 2)];

  const balde = (lista) => {
    if (!lista.length) return null;
    const valor = lista.reduce((s, c) => s + c.valorBruto, 0);
    const km = lista.reduce((s, c) => s + c.km, 0);
    const min = lista.reduce((s, c) => s + (Number(c.duracaoMin) || 0), 0);
    return {
      corridas: lista.length,
      fatia: arredondar(lista.length / validas.length, 2),
      reaisPorKm: km > 0 ? arredondar(valor / km, 2) : null,
      reaisPorHora: min > 0 ? arredondar((valor / min) * 60, 2) : null,
      kmMedio: arredondar(km / lista.length, 1),
    };
  };

  return {
    suficiente: true,
    corteKm: arredondar(corte, 1),
    curtas: balde(validas.filter((c) => c.km <= corte)),
    longas: balde(validas.filter((c) => c.km > corte)),
  };
}

/* ------------------------------------------------------------ a região */

/** Célula do mapa a que um ponto pertence. Grade fixa, sem clusterização. */
export function celulaDe(ponto) {
  if (!Number.isFinite(ponto?.lat) || !Number.isFinite(ponto?.lon)) return null;
  return `${Math.floor(ponto.lat / CELULA)}:${Math.floor(ponto.lon / CELULA)}`;
}

/**
 * Quanto rendeu cada região em que ele esteve.
 *
 * Cruza os trechos de ganho com o rastro do GPS: para cada trecho, a célula
 * onde ele passou mais tempo leva o ganho daquele trecho.
 *
 * ISTO NÃO MEDE A CIDADE, mede a experiência dele. Região onde ele nunca foi
 * não aparece; região onde ele foi uma vez num dia ruim aparece ruim. Por isso
 * o mínimo de amostra, e por isso o prompt tem que dizer isso em voz alta.
 */
/**
 * A célula em que ele passou mais tempo durante o trecho.
 *
 * Exportada porque o treino do modelo precisa exatamente disto, e uma segunda
 * implementação divergiria da primeira na primeira correção.
 */
export function regiaoDoTrecho(trecho, pontos) {
  const dentro = (pontos || []).filter((p) => p.quando >= trecho.inicio && p.quando <= trecho.fim);
  if (!dentro.length) return null;

  const contagem = new Map();
  for (const p of dentro) {
    const c = celulaDe(p);
    if (c) contagem.set(c, (contagem.get(c) || 0) + 1);
  }
  if (!contagem.size) return null;
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function porRegiao(trechos, trilha, { minimo = MINIMO_TRECHOS_REGIAO } = {}) {
  const pontos = (trilha || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.quando))
    .sort((a, b) => a.quando - b.quando);
  if (!pontos.length) return [];

  const porCelula = new Map();

  for (const t of trechos || []) {
    const celula = regiaoDoTrecho(t, pontos);
    if (!celula) continue;

    const balde = porCelula.get(celula) || { celula, trechos: 0, ms: 0, valor: 0, periodos: new Set() };
    balde.trechos += 1;
    balde.ms += t.ms;
    balde.valor += t.valor;
    balde.periodos.add(t.periodo);
    porCelula.set(celula, balde);
  }

  return [...porCelula.values()]
    .filter((b) => b.trechos >= minimo)
    .map((b, i) => ({
      // Rótulo neutro: a célula é coordenada, e coordenada não sai do aparelho.
      regiao: `região ${i + 1}`,
      celula: b.celula,
      trechos: b.trechos,
      horas: arredondar(b.ms / M.HORA, 2),
      reaisPorHora: b.ms > 0 ? arredondar(b.valor / (b.ms / M.HORA), 2) : null,
      periodos: [...b.periodos],
    }))
    .sort((a, b) => (b.reaisPorHora ?? 0) - (a.reaisPorHora ?? 0));
}

/* ------------------------------------------------------------- o padrão */

/**
 * O que ele costuma render em cada hora de cada dia da semana.
 *
 * É a base para "hoje está abaixo do seu normal": sem o padrão, um dia ruim e
 * um dia comum são indistinguíveis.
 */
export function padraoHoraDia(trechos, { minimo = MINIMO_DIAS_PADRAO } = {}) {
  const baldes = new Map();

  for (const t of trechos || []) {
    const d = new Date(t.inicio);
    const chave = `${d.getDay()}:${d.getHours()}`;
    const b = baldes.get(chave) || { dia: d.getDay(), hora: d.getHours(), ms: 0, valor: 0, dias: new Set() };
    b.ms += t.ms;
    b.valor += t.valor;
    b.dias.add(M.chaveData(t.inicio));
    baldes.set(chave, b);
  }

  return [...baldes.values()]
    .filter((b) => b.dias.size >= minimo)
    .map((b) => ({
      dia: b.dia,
      hora: b.hora,
      amostraDias: b.dias.size,
      reaisPorHora: b.ms > 0 ? arredondar(b.valor / (b.ms / M.HORA), 2) : null,
    }))
    .sort((a, b) => (b.reaisPorHora ?? 0) - (a.reaisPorHora ?? 0));
}

/* ------------------------------------------------------- o que aceitou */

/**
 * A qualidade do que ele aceitou, contra a faixa do próprio período.
 *
 * Responde "peguei muitas corridas ruins?" com número em vez de sensação.
 */
export function qualidadeDoAceite(corridas, referencia) {
  const validas = M.corridasValidas(corridas);
  if (!validas.length || !referencia) return null;

  let abaixoDoPiso = 0;
  let acimaDoIdeal = 0;
  let comparadas = 0;

  for (const c of validas) {
    const faixa = referencia[M.periodoDe(c.timestamp)]?.hora;
    if (!faixa?.piso || !(c.duracaoMin > 0) || !(c.valorBruto > 0)) continue;
    const rh = (c.valorBruto / c.duracaoMin) * 60;
    comparadas += 1;
    if (rh < faixa.piso) abaixoDoPiso += 1;
    if (rh >= faixa.ideal) acimaDoIdeal += 1;
  }

  if (!comparadas) return null;
  return {
    comparadas,
    abaixoDoPiso,
    acimaDoIdeal,
    fatiaAbaixoDoPiso: arredondar(abaixoDoPiso / comparadas, 2),
  };
}

/* ------------------------------------------------------ o pacote todo */

/**
 * Tudo junto, pronto para o assistente.
 *
 * Nenhum número aqui é novo: todos saem de funções que o app já usa nas abas.
 * O assistente lê o mesmo que as telas mostram, e não uma segunda verdade.
 */
export function diagnostico({
  jornadas = [],
  registros = [],
  pausas = [],
  corridas = [],
  trilha = [],
  referencia = null,
  jornadaAberta = null,
  eventosDoDia = null,
  agora = Date.now(),
} = {}) {
  const trechos = F.trechosDe(jornadas, registros);

  return {
    turno: jornadaAberta
      ? situacaoDoTurno({
          jornada: jornadaAberta,
          registros: registros.filter((r) => r.jornadaId === jornadaAberta.id),
          pausas: pausas.filter((p) => p.jornadaId === jornadaAberta.id),
          eventos: eventosDoDia,
          agora,
        })
      : null,
    ociosidade: ociosidade(trechos),
    mistura: misturaDeCorridas(corridas),
    regioes: porRegiao(trechos, trilha),
    melhoresHoras: padraoHoraDia(trechos).slice(0, 12),
    pioresHoras: padraoHoraDia(trechos).slice(-6).reverse(),
    aceite: qualidadeDoAceite(corridas, referencia),
    trechosAnalisados: trechos.length,
  };
}

function arredondar(valor, casas) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
