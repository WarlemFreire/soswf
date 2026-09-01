// rotina.js — o plano da semana. Puro: sem DOM, sem banco, sem relógio.
//
// A rotina é um molde, não um registro. Ela diz o que o motorista PRETENDE
// fazer nos sete dias da semana; quem guarda o que ele fez de verdade são as
// jornadas. Por isso nada aqui olha para Date.now(): dois moldes iguais têm
// que produzir os mesmos números hoje, amanhã e no ano que vem.

import { PERIODOS } from "./config.js";
import { FOLGA_MAXIMA } from "./conquistas.js";

export const MIN_DIA = 1440;

/** Meia-noite mais doze horas: até onde a madrugada de um dia pode esticar. */
export const LIMITE_BLOCO = MIN_DIA + 12 * 60;

export const DIAS = [
  { id: 0, nome: "Domingo", curto: "Dom", sigla: "D" },
  { id: 1, nome: "Segunda", curto: "Seg", sigla: "S" },
  { id: 2, nome: "Terça", curto: "Ter", sigla: "T" },
  { id: 3, nome: "Quarta", curto: "Qua", sigla: "Q" },
  { id: 4, nome: "Quinta", curto: "Qui", sigla: "Q" },
  { id: 5, nome: "Sexta", curto: "Sex", sigla: "S" },
  { id: 6, nome: "Sábado", curto: "Sáb", sigla: "S" },
];

export const TIPOS = [
  { id: "trabalho", nome: "Rodar", icone: "🚕", conta: true },
  { id: "almoco", nome: "Almoço", icone: "🍽️", conta: false },
  { id: "descanso", nome: "Descanso", icone: "☕", conta: false },
];

export const ehTrabalho = (bloco) => bloco.tipo === "trabalho";

/* ------------------------------------------------------------- limiares */

/** Acima disso o dia é longo o bastante para valer um aviso. */
export const LIMITE_DIA_MIN = 12 * 60;
/** Descanso mínimo entre o fim de um dia e o começo do seguinte. */
export const DESCANSO_MINIMO_MIN = 8 * 60;
/** Turno mais longo que isso sem nenhuma pausa planejada pede uma parada. */
export const TURNO_SEM_PAUSA_MIN = 5 * 60;

/* --------------------------------------------------------------- modelo */

export function rotinaVazia() {
  return { dias: Object.fromEntries(DIAS.map((d) => [d.id, []])) };
}

/**
 * Põe a rotina em forma canônica: sete dias, blocos válidos e em ordem.
 *
 * Um bloco pode terminar depois da meia-noite — o turno que começa 22h e
 * acaba 2h pertence ao dia em que COMEÇOU, senão a semana de quem roda de
 * madrugada ficaria picotada em dois pedaços por dia.
 */
export function normalizar(rotina) {
  const saida = rotinaVazia();
  for (const dia of DIAS) {
    const brutos = rotina?.dias?.[dia.id] ?? rotina?.dias?.[String(dia.id)] ?? [];
    saida.dias[dia.id] = brutos
      .map((b, i) => ({
        id: b.id || `${dia.id}-${i}`,
        tipo: TIPOS.some((t) => t.id === b.tipo) ? b.tipo : "trabalho",
        // O começo também pode passar da meia-noite: numa noite que vai das
        // 21h às 4h, a pausa da 1h e o trecho seguinte pertencem a ESTE dia.
        // Prender o início em 23:59 empurrava o bloco seguinte para cima do
        // anterior e fabricava conflito onde não havia.
        inicio: Math.max(0, Math.min(LIMITE_BLOCO, Math.round(Number(b.inicio) || 0))),
        fim: Math.round(Number(b.fim) || 0),
      }))
      .filter((b) => Number.isFinite(b.inicio) && b.fim > b.inicio && b.fim <= LIMITE_BLOCO)
      .sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  }
  return saida;
}

/** Pares que se sobrepõem — dois compromissos no mesmo minuto. */
export function conflitos(blocos) {
  const achados = [];
  const lista = [...blocos].sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < lista.length; i++) {
    if (lista[i].inicio < lista[i - 1].fim) achados.push([lista[i - 1], lista[i]]);
  }
  return achados;
}

/* --------------------------------------------------------------- totais */

export function resumoDoDia(blocos = []) {
  const trabalho = blocos.filter(ehTrabalho).reduce((s, b) => s + (b.fim - b.inicio), 0);
  const pausa = blocos.filter((b) => !ehTrabalho(b)).reduce((s, b) => s + (b.fim - b.inicio), 0);
  const inicio = blocos.length ? Math.min(...blocos.map((b) => b.inicio)) : null;
  const fim = blocos.length ? Math.max(...blocos.map((b) => b.fim)) : null;

  return {
    trabalho,
    pausa,
    inicio,
    fim,
    // Da primeira à última hora do dia: é quanto tempo ele fica FORA de casa,
    // que é diferente do que ele passa rodando.
    janela: inicio == null ? 0 : fim - inicio,
    turnos: turnosDe(blocos).length,
    vazio: blocos.length === 0,
    conflitos: conflitos(blocos),
  };
}

/**
 * Turno é trabalho colado: blocos de rodar separados só por pausa continuam
 * no mesmo turno. Ir para casa e voltar depois é que abre um turno novo.
 */
export function turnosDe(blocos = []) {
  const trabalho = blocos.filter(ehTrabalho).sort((a, b) => a.inicio - b.inicio);
  const pausas = blocos.filter((b) => !ehTrabalho(b));
  const turnos = [];

  for (const bloco of trabalho) {
    const atual = turnos[turnos.length - 1];
    const emenda =
      atual &&
      (bloco.inicio <= atual.fim ||
        pausas.some((p) => p.inicio <= atual.fim && p.fim >= bloco.inicio));
    if (emenda) {
      atual.fim = Math.max(atual.fim, bloco.fim);
      atual.trabalho += bloco.fim - bloco.inicio;
    } else {
      turnos.push({ inicio: bloco.inicio, fim: bloco.fim, trabalho: bloco.fim - bloco.inicio });
    }
  }
  return turnos;
}

export function resumoDaSemana(rotina) {
  const norma = normalizar(rotina);
  const porDia = DIAS.map((d) => ({ dia: d.id, ...resumoDoDia(norma.dias[d.id]) }));
  const rodados = porDia.filter((d) => d.trabalho > 0);

  return {
    porDia,
    trabalho: porDia.reduce((s, d) => s + d.trabalho, 0),
    pausa: porDia.reduce((s, d) => s + d.pausa, 0),
    diasRodados: rodados.length,
    folgas: 7 - rodados.length,
    media: rodados.length ? porDia.reduce((s, d) => s + d.trabalho, 0) / rodados.length : 0,
    maiorDia: rodados.reduce((a, d) => (!a || d.trabalho > a.trabalho ? d : a), null),
  };
}

/* ------------------------------------------------- distribuição no relógio */

/** Minutos de trabalho em cada hora do relógio (0–23), somando a semana. */
export function minutosPorHora(rotina) {
  const horas = new Array(24).fill(0);
  const norma = normalizar(rotina);
  for (const dia of DIAS) {
    for (const bloco of norma.dias[dia.id].filter(ehTrabalho)) espalhar(horas, bloco);
  }
  return horas;
}

/** Minutos de trabalho de UM dia em cada hora do relógio. */
export function minutosPorHoraDoDia(blocos = []) {
  const horas = new Array(24).fill(0);
  for (const bloco of blocos.filter(ehTrabalho)) espalhar(horas, bloco);
  return horas;
}

function espalhar(horas, bloco) {
  let cursor = bloco.inicio;
  while (cursor < bloco.fim) {
    const fimDaHora = (Math.floor(cursor / 60) + 1) * 60;
    const ate = Math.min(fimDaHora, bloco.fim);
    // Depois da meia-noite o relógio recomeça: 25h é 1h do dia seguinte.
    horas[Math.floor(cursor / 60) % 24] += ate - cursor;
    cursor = ate;
  }
}

export function minutosPorPeriodo(rotina) {
  const horas = minutosPorHora(rotina);
  const soma = Object.fromEntries(PERIODOS.map((p) => [p.id, 0]));
  for (let h = 0; h < 24; h++) soma[periodoDaHora(h)] += horas[h];
  return soma;
}

function periodoDaHora(h) {
  for (const p of PERIODOS) {
    const dentro = p.inicio < p.fim ? h >= p.inicio && h < p.fim : h >= p.inicio || h < p.fim;
    if (dentro) return p.id;
  }
  return PERIODOS[0].id;
}

/* ------------------------------------------------------------- projeção */

/**
 * Quanto a semana planejada renderia no ritmo que ele JÁ teve em cada hora do
 * relógio.
 *
 * `cobertura` é a parte honesta: diz que fração do plano caiu em horas que ele
 * realmente já rodou. Com cobertura baixa o número é quase todo chute do valor
 * padrão, e a tela precisa poder dizer isso em vez de exibir um total com ar
 * de medição.
 */
export function projecao(rotina, { taxaPorHora = [], taxaPadrao = 0 } = {}) {
  const norma = normalizar(rotina);
  const util = (h) => (Number.isFinite(taxaPorHora[h]) && taxaPorHora[h] > 0 ? taxaPorHora[h] : null);

  let medidos = 0;
  let total = 0;
  const porDia = DIAS.map((d) => {
    const horas = minutosPorHoraDoDia(norma.dias[d.id]);
    let ganho = 0;
    let minutos = 0;
    for (let h = 0; h < 24; h++) {
      if (!horas[h]) continue;
      const taxa = util(h);
      ganho += (horas[h] / 60) * (taxa ?? taxaPadrao);
      minutos += horas[h];
      if (taxa != null) medidos += horas[h];
      total += horas[h];
    }
    return { dia: d.id, minutos, ganho };
  });

  return {
    porDia,
    ganho: porDia.reduce((s, d) => s + d.ganho, 0),
    minutos: total,
    cobertura: total > 0 ? medidos / total : 0,
  };
}

/* --------------------------------------------------------------- avisos */

/**
 * O que o plano cobra do corpo. Nenhum destes é proibição — é o app dizendo
 * em voz alta o que a semana pede, para a escolha ser consciente.
 */
export function avisos(rotina) {
  const norma = normalizar(rotina);
  const resumo = resumoDaSemana(norma);
  const lista = [];

  for (const dia of DIAS) {
    const blocos = norma.dias[dia.id];
    const d = resumo.porDia[dia.id];

    if (d.conflitos.length) {
      lista.push({ tipo: "conflito", dia: dia.id, grau: "alerta", texto: `${dia.nome}: dois blocos no mesmo horário.` });
    }
    if (d.trabalho > LIMITE_DIA_MIN) {
      lista.push({ tipo: "dia_longo", dia: dia.id, grau: "alerta", texto: `${dia.nome} pede ${formatarDuracao(d.trabalho)} de volante.` });
    }
    for (const turno of turnosDe(blocos)) {
      const temPausa = blocos.some((b) => !ehTrabalho(b) && b.inicio >= turno.inicio && b.fim <= turno.fim);
      if (turno.trabalho > TURNO_SEM_PAUSA_MIN && !temPausa) {
        lista.push({
          tipo: "sem_pausa",
          dia: dia.id,
          grau: "aviso",
          texto: `${dia.nome}: ${formatarDuracao(turno.trabalho)} seguidos sem pausa planejada.`,
        });
        break;
      }
    }
  }

  // Descanso entre um dia e o seguinte, dando a volta na semana.
  for (const dia of DIAS) {
    const hoje = resumo.porDia[dia.id];
    const amanha = resumo.porDia[(dia.id + 1) % 7];
    if (hoje.vazio || amanha.vazio) continue;
    const folga = MIN_DIA + amanha.inicio - hoje.fim;
    if (folga < DESCANSO_MINIMO_MIN) {
      lista.push({
        tipo: "descanso_curto",
        dia: dia.id,
        grau: "alerta",
        texto: `Entre ${dia.nome} e ${DIAS[(dia.id + 1) % 7].nome} sobram ${formatarDuracao(folga)} de descanso.`,
      });
    }
  }

  // A rotina conversa com a ofensiva: passar da folga tolerada zera a corrente.
  const maior = maiorSequenciaDeFolga(resumo.porDia);
  if (maior > FOLGA_MAXIMA && resumo.diasRodados > 0) {
    lista.push({
      tipo: "ofensiva",
      dia: null,
      grau: "aviso",
      texto: `${maior} folgas seguidas quebram a ofensiva — o limite é ${FOLGA_MAXIMA}.`,
    });
  }
  if (resumo.diasRodados === 7) {
    lista.push({ tipo: "sem_folga", dia: null, grau: "aviso", texto: "Sete dias sem folga na semana." });
  }
  return lista;
}

/** A maior corrida de folgas, tratando a semana como um anel. */
function maiorSequenciaDeFolga(porDia) {
  const folga = porDia.map((d) => d.vazio || d.trabalho === 0);
  if (folga.every(Boolean)) return 7;
  let maior = 0;
  let corrente = 0;
  // Duas voltas para que uma sequência que cruza sábado→domingo seja vista.
  for (let i = 0; i < 14; i++) {
    corrente = folga[i % 7] ? corrente + 1 : 0;
    maior = Math.max(maior, Math.min(corrente, 7));
  }
  return maior;
}

/* ------------------------------------------------------------ hoje */

/** Minutos desde a meia-noite do instante dado. */
export function minutosDoDia(agora) {
  const d = new Date(agora);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Qual plano vale AGORA.
 *
 * Normalmente é o de hoje. Mas às 3 da manhã de terça, quem está na rua está
 * cumprindo o plano de SEGUNDA — o turno que atravessou a meia-noite. Olhar
 * para o dia do calendário faria o app dizer "folga" para alguém trabalhando.
 */
export function planoVigente(rotina, agora = Date.now(), { desde = null } = {}) {
  const norma = normalizar(rotina);
  const hoje = new Date(agora).getDay();
  const minutos = minutosDoDia(agora);

  // Com uma jornada aberta desde ontem, o plano em curso é o DELA, mesmo que
  // o horário planejado já tenha passado. Sem isto, às 2h da manhã de terça o
  // app trocaria de assunto no meio do turno e começaria a falar do plano da
  // terça enquanto ele ainda está na rua cumprindo o da segunda.
  if (desde != null) {
    const dias = Math.round((meiaNoiteDe(agora) - meiaNoiteDe(desde)) / (MIN_DIA * 60000));
    if (dias === 1) {
      const dono = new Date(desde).getDay();
      return { dia: dono, blocos: norma.dias[dono], deOntem: true, agora: minutos + MIN_DIA };
    }
    if (dias === 0) return { dia: hoje, blocos: norma.dias[hoje], deOntem: false, agora: minutos };
  }

  // Sem jornada aberta, ainda vale a noite de ontem enquanto ela nao acabou.
  const ontem = (hoje + 6) % 7;
  const daNoite = norma.dias[ontem];
  const fimDeOntem = daNoite.length ? Math.max(...daNoite.map((b) => b.fim)) : 0;
  if (fimDeOntem > MIN_DIA && minutos + MIN_DIA < fimDeOntem) {
    return { dia: ontem, blocos: daNoite, deOntem: true, agora: minutos + MIN_DIA };
  }
  return { dia: hoje, blocos: norma.dias[hoje], deOntem: false, agora: minutos };
}

function meiaNoiteDe(instante) {
  const d = new Date(instante);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Onde o motorista está dentro do plano vigente. */
export function estadoAgora(rotina, agora = Date.now(), opcoes = {}) {
  const plano = planoVigente(rotina, agora, opcoes);
  const resumo = resumoDoDia(plano.blocos);
  const atual = plano.blocos.find((b) => plano.agora >= b.inicio && plano.agora < b.fim) || null;
  const proximo = plano.blocos.find((b) => b.inicio > plano.agora) || null;

  const cumprido = plano.blocos
    .filter(ehTrabalho)
    .reduce((s, b) => s + Math.max(0, Math.min(b.fim, plano.agora) - b.inicio), 0);

  return {
    ...plano,
    ...resumo,
    blocoAtual: atual,
    proximo,
    // Pausa é o que ele planejou para descansar; saber a próxima ajuda a
    // decidir se estica mais um trecho ou já para.
    proximaPausa: plano.blocos.find((b) => !ehTrabalho(b) && b.inicio > plano.agora) || null,
    cumprido,
    restante: Math.max(0, resumo.trabalho - cumprido),
    antesDeComecar: resumo.inicio != null && plano.agora < resumo.inicio,
    terminou: resumo.fim != null && plano.agora >= resumo.fim,
    faltaParaComecar: resumo.inicio != null ? resumo.inicio - plano.agora : null,
    alemDoPlano: resumo.fim != null && plano.agora >= resumo.fim ? plano.agora - resumo.fim : 0,
  };
}

/**
 * A hora em que o plano de hoje termina, para a projeção da tela principal
 * herdar em vez de usar o limite genérico das configurações.
 *
 * A projeção trabalha com hora cheia, então 04:15 vira 4 — arredondar para
 * baixo mantém a promessa dentro do plano em vez de esticá-la.
 */
export function horaDeParar(rotina, agora = Date.now(), opcoes = {}) {
  const estado = estadoAgora(rotina, agora, opcoes);
  if (estado.fim == null || estado.terminou) return null;
  return Math.floor((estado.fim % MIN_DIA) / 60);
}

/* ------------------------------------------------------------ formatação */

/** "07:00", e "02:00 ⁺¹" quando o horário já é do dia seguinte. */
export function formatarMinutos(min) {
  const doDiaSeguinte = min >= MIN_DIA;
  const m = ((min % MIN_DIA) + MIN_DIA) % MIN_DIA;
  const texto = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return doDiaSeguinte ? `${texto} ⁺¹` : texto;
}

export function formatarDuracao(min) {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
