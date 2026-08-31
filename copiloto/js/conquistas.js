// conquistas.js — ofensiva, medalhas e recordes. Puro e testável no node.
//
// Duas regras de projeto atravessam o arquivo:
//
// 1. RECORDE descreve o passado, MEDALHA convida a repetir. Por isso existe
//    recorde de jornada mais longa, mas nao existe medalha por jornada longa
//    nem por madrugada emendada — transformar cansaço em troféu é empurrar
//    alguem a dirigir exausto.
//
// 2. Medalha conquistada nao volta atras. Toda medida do catalogo é acumulada
//    ou recorde pessoal; nada que possa cair. A ofensiva ATUAL cai, entao as
//    medalhas de ofensiva olham para o RECORDE de ofensiva.

import * as M from "./metrics.js";
import { PLATAFORMAS, PERIODOS } from "./config.js";

const DIA_MS = 86400000;

/* ---------------------------------------------------------------- ofensiva */

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

/* ---------------------------------------------------------------- recordes */

export function recordes(dias, corridas, historico) {
  const lista = dias || [];
  const comTempo = lista.filter((d) => d.msAtivo > 0);
  const comKm = lista.filter((d) => d.km > 0);

  const melhor = (fonte, valor) =>
    fonte.reduce((melhorAte, item) => {
      const v = valor(item);
      if (v == null || !Number.isFinite(v) || v <= 0) return melhorAte;
      return !melhorAte || v > melhorAte.valor ? { valor: v, item } : melhorAte;
    }, null);

  const jornadas = (historico || []).map((r) => r.jornada).filter((j) => j.horaFim && j.origem !== "planilha");

  return [
    formatoDia("Dia mais lucrativo", melhor(lista, (d) => d.saldo), (v) => `R$ ${M.formatarReais(v, { comCentavos: false })}`),
    formatoDia("Melhor R$/hora num dia", melhor(comTempo, (d) => d.reaisPorHora), (v) => `R$ ${v.toFixed(0)}`),
    formatoDia("Melhor R$/km num dia", melhor(comKm, (d) => d.reaisPorKm), (v) => `R$ ${v.toFixed(2).replace(".", ",")}`),
    formatoDia("Mais km num dia", melhor(comKm, (d) => d.km), (v) => `${v.toFixed(0)} km`),
    formatoDia("Mais tempo ativo num dia", melhor(comTempo, (d) => d.msAtivo), (v) => M.formatarDuracao(v)),
    formatoDia("Mais corridas num dia", melhor(lista, (d) => d.corridas.length || null), (v) => `${v}`),
    formatoJornada(
      "Jornada mais longa",
      jornadas.reduce((a, j) => (!a || j.horaFim - j.horaInicio > a.horaFim - a.horaInicio ? j : a), null)
    ),
    formatoCorrida("Maior corrida", (corridas || []).reduce((a, c) => (!a || c.valorBruto > a.valorBruto ? c : a), null)),
  ];
}

function formatoDia(nome, achado, formatar) {
  if (!achado) return { nome, valor: null, quando: null };
  return { nome, valor: formatar(achado.valor), quando: achado.item.data };
}

function formatoJornada(nome, jornada) {
  if (!jornada) return { nome, valor: null, quando: null };
  return { nome, valor: M.formatarDuracao(jornada.horaFim - jornada.horaInicio), quando: jornada.data };
}

function formatoCorrida(nome, corrida) {
  if (!corrida) return { nome, valor: null, quando: null };
  return {
    nome,
    valor: `R$ ${M.formatarReais(corrida.valorBruto)}`,
    quando: M.chaveData(corrida.timestamp),
    detalhe: corrida.bairroOrigem || null,
  };
}

/* ------------------------------------------------------------ estatísticas */

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Domingo e sábado sao masculinos; o resto da semana é feminino.
const ARTIGO_DIA = ["num", "numa", "numa", "numa", "numa", "numa", "num"];
const PLURAL_DIA = ["domingos trabalhados", "segundas trabalhadas", "terças trabalhadas", "quartas trabalhadas", "quintas trabalhadas", "sextas trabalhadas", "sábados trabalhados"];

/** Tudo que as medalhas precisam saber, calculado uma vez só. */
export function estatisticas({ dias = [], historico = [], corridas = [], custos = [], hoje = Date.now() } = {}) {
  const horasPorHora = new Array(24).fill(0);
  const diasSemana = new Array(7).fill(0);

  for (const dia of dias) {
    diasSemana[new Date(dia.inicio).getDay()] += 1;
    for (const resumo of dia.jornadas) espalharTempo(resumo, horasPorHora);
  }

  const horasPorPeriodo = Object.fromEntries(PERIODOS.map((p) => [p.id, 0]));
  const horasVisitadas = new Set();
  for (let h = 0; h < 24; h++) {
    horasPorPeriodo[periodoDaHora(h)] += horasPorHora[h];
    if (horasPorHora[h] > 0) horasVisitadas.add(h);
  }

  const metas = { minima: 0, ideal: 0, otima: 0 };
  for (const dia of dias) {
    const j = dia.jornadas[0]?.jornada;
    if (!j) continue;
    if (dia.saldo >= (j.metaMinima ?? Infinity)) metas.minima += 1;
    if (dia.saldo >= (j.metaIdeal ?? Infinity)) metas.ideal += 1;
    if (dia.saldo >= (j.metaOtima ?? Infinity)) metas.otima += 1;
  }

  const porPlataforma = Object.fromEntries(PLATAFORMAS.map((p) => [p.id, 0]));
  const bairros = new Set();
  let dinamico = 0;
  for (const c of corridas) {
    if (c.plataforma in porPlataforma) porPlataforma[c.plataforma] += 1;
    const b = (c.bairroOrigem || "").trim();
    if (b && b !== "?") bairros.add(b.toLowerCase());
    dinamico += c.valorDinamico || 0;
  }

  const of = ofensiva(dias, hoje);
  const maximo = (fonte) => fonte.reduce((a, v) => (v > a ? v : a), 0);

  return {
    dias: dias.length,
    bruto: dias.reduce((s, d) => s + d.saldo, 0),
    maiorBrutoDia: maximo(dias.map((d) => d.saldo || 0)),
    km: dias.reduce((s, d) => s + (d.km || 0), 0),
    maiorKmDia: maximo(dias.map((d) => d.km || 0)),
    horas: horasPorHora.reduce((s, h) => s + h, 0),
    horasPorHora,
    horasPorPeriodo,
    horasMadrugada: horasPorHora.slice(0, 6).reduce((s, h) => s + h, 0),
    horasVisitadas,
    diasSemana,
    metas,
    corridas: corridas.length,
    maiorCorridasDia: maximo(dias.map((d) => d.corridas.length)),
    porPlataforma,
    bairros: bairros.size,
    dinamico,
    abastecimentos: custos.filter((c) => M.ehCombustivel(c.tipo)).length,
    pausas: historico.reduce((s, r) => s + r.pausas.filter((p) => p.horaFim).length, 0),
    registros: historico.reduce((s, r) => s + r.registros.length, 0),
    melhorRhDia: maximo(dias.map((d) => d.reaisPorHora || 0)),
    melhorRkDia: maximo(dias.map((d) => d.reaisPorKm || 0)),
    ofensiva: of.atual,
    ofensivaRecorde: of.recorde,
  };
}

function periodoDaHora(h) {
  for (const p of PERIODOS) {
    const dentro = p.inicio < p.fim ? h >= p.inicio && h < p.fim : h >= p.inicio || h < p.fim;
    if (dentro) return p.id;
  }
  return PERIODOS[0].id;
}

/**
 * Reparte o tempo ativo da jornada pelas horas de relógio que ela cobre.
 *
 * Dia importado da planilha nao tem pausa registrada: a janela entre a primeira
 * e a última corrida é maior que o tempo realmente rodado. Por isso o resultado
 * bruto é reescalado pelo msAtivo que o resumo conhece — a forma da distribuiçao
 * pelas horas vale, o volume total quem manda é o msAtivo.
 */
function espalharTempo(resumo, horasPorHora) {
  const jornada = resumo.jornada;
  const fim = jornada.horaFim ?? Date.now();
  if (!(fim > jornada.horaInicio)) return;

  const parcial = new Array(24).fill(0);
  let soma = 0;
  let cursor = jornada.horaInicio;
  while (cursor < fim) {
    const d = new Date(cursor);
    const ate = Math.min(new Date(cursor).setMinutes(60, 0, 0), fim);
    const ativo = ate - cursor - M.msPausadoEntre(resumo.pausas || [], cursor, ate);
    if (ativo > 0) {
      parcial[d.getHours()] += ativo / M.HORA;
      soma += ativo / M.HORA;
    }
    cursor = ate;
  }
  if (soma <= 0) return;

  const alvo = resumo.msAtivo != null ? resumo.msAtivo / M.HORA : soma;
  const fator = alvo / soma;
  for (let h = 0; h < 24; h++) horasPorHora[h] += parcial[h] * fator;
}

/* ---------------------------------------------------------------- medalhas */

const REAIS = (v) => `R$ ${M.formatarReais(v, { comCentavos: false })}`;
const HORAS = (v) => `${Math.floor(v)} h`;
const KM = (v) => `${Math.round(v)} km`;
const INT = (v) => `${Math.floor(v)}`;

/** Uma família: mesma medida, alvos crescentes, um nome por degrau. */
function escada({ id, familia, icone, medir, alvos, nomes, descricao, formatar = INT }) {
  return alvos.map((alvo, i) => ({
    id: `${id}-${i + 1}`,
    familia,
    icone,
    nome: nomes[i],
    descricao: descricao(alvo),
    alvo,
    nivel: i + 1,
    niveis: alvos.length,
    medir,
    formatar,
  }));
}

/** Medalha de coleção: sem degraus, só marcar presença. */
function marco({ id, familia, icone, nome, descricao, medir }) {
  return {
    id,
    familia,
    icone,
    nome,
    descricao,
    alvo: 1,
    nivel: 1,
    niveis: 1,
    medir: (e) => (medir(e) ? 1 : 0),
    formatar: () => "",
  };
}

const HORAS_ALVO = [10, 25, 50, 100, 250, 500];

const ESCADA_PERIODO = {
  manha: {
    icone: "🌅",
    nomes: ["Café na Térmica", "Madrugador", "Sol na Cara", "Dono da Manhã", "Senhor do Amanhecer", "Lenda Matinal"],
  },
  tarde: {
    icone: "🌤️",
    nomes: ["Tarde Adentro", "Sombra do Meio-Dia", "Rotina de Tarde", "Dono da Tarde", "Senhor do Poente", "Lenda Vespertina"],
  },
  noite: {
    icone: "🌆",
    nomes: ["Farol Aceso", "Gente da Noite", "Turno da Noite", "Dono da Noite", "Senhor do Breu", "Lenda Noturna"],
  },
  pico: {
    icone: "⚡",
    nomes: ["Hora do Rush", "Encara o Pico", "Caçador de Pico", "Dono do Pico", "Senhor do Rush", "Lenda do Pico"],
  },
};

function catalogo() {
  const medalhas = [];

  // Horas por período do dia (4 famílias × 6). A madrugada tem família própria
  // logo abaixo, com a janela que o motorista usa: meia-noite às 6h.
  for (const p of PERIODOS) {
    const desenho = ESCADA_PERIODO[p.id];
    if (!desenho) continue;
    medalhas.push(
      ...escada({
        id: `periodo-${p.id}`,
        familia: `Horas de ${p.nome}`,
        icone: desenho.icone,
        nomes: desenho.nomes,
        alvos: HORAS_ALVO,
        medir: (e) => e.horasPorPeriodo[p.id],
        descricao: (a) => `${a} horas rodadas entre ${p.inicio}h e ${p.fim}h`,
        formatar: HORAS,
      })
    );
  }

  medalhas.push(
    ...escada({
      id: "madrugada",
      familia: "Madrugada",
      icone: "🌙",
      nomes: ["Varando a Noite", "Coruja", "Insone", "Rei da Madrugada", "Senhor das Três da Manhã", "Lenda da Madrugada"],
      alvos: HORAS_ALVO,
      medir: (e) => e.horasMadrugada,
      descricao: (a) => `${a} horas rodadas entre meia-noite e 6h`,
      formatar: HORAS,
    }),

    ...escada({
      id: "bruto",
      familia: "Faturamento",
      icone: "💰",
      nomes: ["Primeiro Mil", "R$5 mil", "R$10 mil", "R$25 mil", "R$50 mil", "R$100 mil", "Quarto de Milhão", "Meio Milhão"],
      alvos: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000],
      medir: (e) => e.bruto,
      descricao: (a) => `${REAIS(a)} acumulados desde o começo`,
      formatar: REAIS,
    }),

    ...escada({
      id: "dia-bruto",
      familia: "Dia Cheio",
      icone: "🔥",
      nomes: ["Dia de R$200", "Dia de R$300", "Dia de R$400", "Dia de R$500", "Dia de R$600", "Dia de R$800", "Dia de R$1.000"],
      alvos: [200, 300, 400, 500, 600, 800, 1000],
      medir: (e) => e.maiorBrutoDia,
      descricao: (a) => `Fechar um dia com ${REAIS(a)} ou mais`,
      formatar: REAIS,
    }),

    ...escada({
      id: "dias",
      familia: "Estrada",
      icone: "🛣️",
      nomes: ["Primeiro Dia", "5 Dias na Rua", "10 Dias na Rua", "25 Dias na Rua", "50 Dias na Rua", "100 Dias na Rua", "200 Dias na Rua", "Um Ano de Ruas", "500 Dias na Rua", "Mil Dias na Rua"],
      alvos: [1, 5, 10, 25, 50, 100, 200, 365, 500, 1000],
      medir: (e) => e.dias,
      descricao: (a) => `${a} dias com jornada registrada`,
      formatar: (v) => `${v} dias`,
    }),

    ...escada({
      id: "ofensiva",
      familia: "Ofensiva",
      icone: "🔥",
      nomes: ["Três Seguidos", "Uma Semana", "Duas Semanas", "Um Mês", "Dois Meses", "Ofensiva de 100", "Ofensiva de 200", "Um Ano Inteiro"],
      alvos: [3, 7, 14, 30, 60, 100, 200, 365],
      medir: (e) => e.ofensivaRecorde,
      descricao: (a) => `Chegar a uma ofensiva de ${a} dias`,
      formatar: (v) => `${v} dias`,
    }),

    ...escada({
      id: "km",
      familia: "Quilometragem",
      icone: "🧭",
      nomes: ["500 km", "Mil km", "5 mil km", "10 mil km", "25 mil km", "50 mil km", "100 mil km", "200 mil km"],
      alvos: [500, 1000, 5000, 10000, 25000, 50000, 100000, 200000],
      medir: (e) => e.km,
      descricao: (a) => `${KM(a)} rodados no total`,
      formatar: KM,
    }),

    ...escada({
      id: "dia-km",
      familia: "Pernão",
      icone: "🛞",
      nomes: ["100 km num dia", "150 km num dia", "200 km num dia", "250 km num dia", "300 km num dia", "400 km num dia"],
      alvos: [100, 150, 200, 250, 300, 400],
      medir: (e) => e.maiorKmDia,
      descricao: (a) => `Fechar um dia com ${KM(a)}`,
      formatar: KM,
    }),

    ...escada({
      id: "corridas",
      familia: "Corridas",
      icone: "🚕",
      nomes: ["10 Corridas", "50 Corridas", "100 Corridas", "500 Corridas", "Mil Corridas", "2.500 Corridas", "5 Mil Corridas", "10 Mil Corridas"],
      alvos: [10, 50, 100, 500, 1000, 2500, 5000, 10000],
      medir: (e) => e.corridas,
      descricao: (a) => `${a} corridas detalhadas no app`,
      formatar: (v) => `${v} corridas`,
    }),

    ...escada({
      id: "dia-corridas",
      familia: "Rodízio",
      icone: "🎯",
      nomes: ["10 num dia", "15 num dia", "20 num dia", "25 num dia", "30 num dia"],
      alvos: [10, 15, 20, 25, 30],
      medir: (e) => e.maiorCorridasDia,
      descricao: (a) => `${a} corridas num único dia`,
      formatar: (v) => `${v} corridas`,
    }),

    ...escada({
      id: "rh",
      familia: "R$ por hora",
      icone: "⏱️",
      nomes: ["R$25 por hora", "R$30 por hora", "R$35 por hora", "R$40 por hora", "R$50 por hora", "R$60 por hora", "R$75 por hora", "R$100 por hora"],
      alvos: [25, 30, 35, 40, 50, 60, 75, 100],
      medir: (e) => e.melhorRhDia,
      descricao: (a) => `Fechar um dia a R$ ${a} por hora`,
      formatar: (v) => `${v.toFixed(0)} R$/h`,
    }),

    ...escada({
      id: "rk",
      familia: "R$ por km",
      icone: "📏",
      nomes: ["R$1,20 por km", "R$1,50 por km", "R$1,80 por km", "R$2,20 por km", "R$2,60 por km", "R$3,00 por km"],
      alvos: [1.2, 1.5, 1.8, 2.2, 2.6, 3.0],
      medir: (e) => e.melhorRkDia,
      descricao: (a) => `Fechar um dia a R$ ${a.toFixed(2).replace(".", ",")} por km`,
      formatar: (v) => `${v.toFixed(2).replace(".", ",")} R$/km`,
    }),

    ...escada({
      id: "horas",
      familia: "Horas na Rua",
      icone: "🕰️",
      nomes: ["10 Horas na Rua", "50 Horas na Rua", "100 Horas na Rua", "250 Horas na Rua", "500 Horas na Rua", "Mil Horas na Rua", "2 Mil Horas na Rua"],
      alvos: [10, 50, 100, 250, 500, 1000, 2000],
      medir: (e) => e.horas,
      descricao: (a) => `${a} horas ativas acumuladas`,
      formatar: HORAS,
    }),

    ...escada({
      id: "abastece",
      familia: "Abastecimento",
      icone: "⛽",
      nomes: ["Primeiro Tanque", "10 Tanques", "25 Tanques", "50 Tanques", "100 Tanques", "250 Tanques"],
      alvos: [1, 10, 25, 50, 100, 250],
      medir: (e) => e.abastecimentos,
      descricao: (a) => `${a} abastecimentos registrados`,
    }),

    ...escada({
      id: "pausa",
      familia: "Descanso",
      icone: "☕",
      nomes: ["Sabe Parar", "Café Merecido", "Ritmo Sustentável", "Descanso é Estratégia"],
      alvos: [5, 25, 100, 365],
      medir: (e) => e.pausas,
      descricao: (a) => `${a} pausas registradas — parar também é trabalho`,
    }),

    ...escada({
      id: "bairro",
      familia: "Território",
      icone: "🗺️",
      nomes: ["5 Bairros", "10 Bairros", "25 Bairros", "50 Bairros", "100 Bairros"],
      alvos: [5, 10, 25, 50, 100],
      medir: (e) => e.bairros,
      descricao: (a) => `Corridas saindo de ${a} bairros diferentes`,
      formatar: (v) => `${v} bairros`,
    }),

    ...escada({
      id: "dinamico",
      familia: "Dinâmico",
      icone: "📈",
      nomes: ["R$50 de dinâmico", "R$200 de dinâmico", "R$500 de dinâmico", "R$1.000 de dinâmico", "R$2.500 de dinâmico"],
      alvos: [50, 200, 500, 1000, 2500],
      medir: (e) => e.dinamico,
      descricao: (a) => `${REAIS(a)} vindos de dinâmico e bônus`,
      formatar: REAIS,
    }),

    ...escada({
      id: "registro",
      familia: "Disciplina",
      icone: "✍️",
      nomes: ["10 Registros", "100 Registros", "500 Registros", "Mil Registros", "5 Mil Registros"],
      alvos: [10, 100, 500, 1000, 5000],
      medir: (e) => e.registros,
      descricao: (a) => `${a} checkpoints registrados no app`,
    })
  );

  // Metas batidas — três níveis × cinco degraus.
  const NIVEIS_META = [
    { id: "minima", nome: "Meta Mínima", icone: "🥉" },
    { id: "ideal", nome: "Meta Ideal", icone: "🥈" },
    { id: "otima", nome: "Meta Ótima", icone: "🥇" },
  ];
  const DEGRAUS_META = ["Primeira vez", "Cinco vezes", "Dez vezes", "Vinte e cinco vezes", "Cinquenta vezes"];
  for (const n of NIVEIS_META) {
    medalhas.push(
      ...escada({
        id: `meta-${n.id}`,
        familia: n.nome,
        icone: n.icone,
        nomes: DEGRAUS_META.map((d) => `${n.nome}: ${d}`),
        alvos: [1, 5, 10, 25, 50],
        medir: (e) => e.metas[n.id],
        descricao: (a) => `Bater a ${n.nome.toLowerCase()} em ${a} dias`,
        formatar: (v) => `${v} dias`,
      })
    );
  }

  // Dias da semana — quatro degraus para cada um dos sete dias.
  const DEGRAUS_SEMANA = ["Estreante", "Frequentador", "Fiel", "Veterano"];
  DIAS_SEMANA.forEach((dia, indice) => {
    medalhas.push(
      ...escada({
        id: `semana-${indice}`,
        familia: dia,
        icone: "📅",
        nomes: DEGRAUS_SEMANA.map((d) => `${d} de ${dia}`),
        alvos: [5, 15, 30, 60],
        medir: (e) => e.diasSemana[indice],
        descricao: (a) => `${a} ${PLURAL_DIA[indice]}`,
        formatar: (v) => `${v} dias`,
      })
    );
  });

  // Corridas por plataforma.
  const DEGRAUS_APP = ["Conhecido", "Parceiro", "Veterano", "Mestre", "Lenda"];
  for (const p of PLATAFORMAS) {
    medalhas.push(
      ...escada({
        id: `app-${p.id}`,
        familia: p.nome,
        icone: "📱",
        nomes: DEGRAUS_APP.map((d) => `${d} da ${p.nome}`),
        alvos: [10, 50, 100, 500, 1000],
        medir: (e) => e.porPlataforma[p.id] || 0,
        descricao: (a) => `${a} corridas registradas pela ${p.nome}`,
        formatar: (v) => `${v} corridas`,
      })
    );
  }

  // Coleções: uma medalha por hora do relógio e uma por dia da semana.
  for (let h = 0; h < 24; h++) {
    medalhas.push(
      marco({
        id: `relogio-${h}`,
        familia: "Volta ao Relógio",
        icone: "🕐",
        nome: `${String(h).padStart(2, "0")}h`,
        descricao: `Já rodou nesta hora do dia`,
        medir: (e) => e.horasVisitadas.has(h),
      })
    );
  }
  DIAS_SEMANA.forEach((dia, indice) => {
    medalhas.push(
      marco({
        id: `presenca-${indice}`,
        familia: "Semana Completa",
        icone: "🗓️",
        nome: dia,
        descricao: `Já trabalhou ${ARTIGO_DIA[indice]} ${dia.toLowerCase()}`,
        medir: (e) => e.diasSemana[indice] > 0,
      })
    );
  });

  return medalhas;
}

export const MEDALHAS = catalogo();

/** Avalia o catálogo inteiro contra as estatísticas. Nada aqui pode regredir. */
export function avaliar(est) {
  return MEDALHAS.map((m) => {
    const atual = Number(m.medir(est)) || 0;
    return {
      ...m,
      atual,
      conquistada: atual >= m.alvo,
      progresso: Math.max(0, Math.min(1, atual / m.alvo)),
      texto: m.formatar(atual),
      textoAlvo: m.formatar(m.alvo),
    };
  });
}

/**
 * Agrupa por família mostrando só o degrau que importa: o mais alto conquistado
 * e o próximo a caminho. Uma lista de 222 linhas nao se lê dirigindo.
 */
export function porFamilia(avaliadas) {
  const familias = new Map();
  for (const m of avaliadas) {
    if (!familias.has(m.familia)) familias.set(m.familia, { nome: m.familia, icone: m.icone, medalhas: [] });
    familias.get(m.familia).medalhas.push(m);
  }
  return [...familias.values()].map((f) => {
    const medalhas = f.medalhas.sort((a, b) => a.nivel - b.nivel);
    const conquistadas = medalhas.filter((m) => m.conquistada);
    return {
      ...f,
      medalhas,
      total: medalhas.length,
      conquistadas: conquistadas.length,
      atual: conquistadas.at(-1) || null,
      proxima: medalhas.find((m) => !m.conquistada) || null,
    };
  });
}

/** As que estão mais perto de cair — o que dá vontade de perseguir hoje. */
export function proximas(avaliadas, quantas = 5) {
  return avaliadas
    .filter((m) => !m.conquistada && m.progresso > 0)
    .sort((a, b) => b.progresso - a.progresso)
    .slice(0, quantas);
}

export function resumoMedalhas(avaliadas) {
  const conquistadas = avaliadas.filter((m) => m.conquistada).length;
  return { total: avaliadas.length, conquistadas, restantes: avaliadas.length - conquistadas };
}
