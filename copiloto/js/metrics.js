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

/** A faixa do período de um instante. Serve para km e para hora. */
export function faixaKmDe(quando, faixas) {
  if (!faixas) return null;
  return faixas[periodoDe(quando)] || faixas.tarde || null;
}

/* ------------------------------------------------------------------ saldos */

/**
 * O dinheiro tem UMA fonte de verdade: a linha do tempo do dia.
 *
 * Cada evento é uma leitura do que a plataforma mostrava naquele instante. O
 * saldo do dia é sempre o último valor lido de cada plataforma, mais os
 * avulsos — nunca uma soma de pedaços.
 *
 * A versão anterior mantinha duas contas paralelas (o total das jornadas
 * anteriores e a linha de base declarada na abertura) que precisavam
 * concordar entre si. Quando discordavam, o mesmo dinheiro entrava duas
 * vezes. Aqui isso é impossível: existe uma conta só.
 */
export function eventosDoDia(jornadas, registros) {
  const eventos = [];

  // A abertura de jornada declara onde o dia estava naquele momento. Vale como
  // leitura: se o motorista já tinha R$100 antes de começar, é isso que a
  // plataforma mostrava.
  for (const j of jornadas || []) {
    const declarado = j.saldoInicial || {};
    if (Object.keys(declarado).length) {
      eventos.push({
        id: `abertura-${j.id}`,
        timestamp: j.horaInicio,
        saldos: declarado,
        abertura: true,
      });
    }
  }

  for (const r of registrosValidos(registros)) eventos.push(r);
  return eventos.sort((a, b) => a.timestamp - b.timestamp);
}

/** Estado de cada fonte de dinheiro depois de percorrer os eventos. */
export function saldoPorFonte(eventos) {
  const fontes = {};
  for (const p of PLATAFORMAS) fontes[p.id] = { valor: 0, visto: null };
  fontes.avulso = { valor: 0, visto: null };

  for (const e of ordenados(eventos)) {
    if (e.desfeito) continue;
    // Plataforma: o número novo SUBSTITUI o anterior, porque o app dela mostra
    // o acumulado do dia, não o da última corrida.
    for (const [id, valor] of Object.entries(e.saldos || {})) {
      if (!(id in fontes) || valor == null) continue;
      fontes[id] = { valor: Number(valor), visto: e.timestamp };
    }
    // Avulso é incremento: um frete de R$80 soma, não substitui.
    if (e.avulso && e.avulso.valor != null) {
      fontes.avulso = { valor: fontes.avulso.valor + Number(e.avulso.valor), visto: e.timestamp };
    }
  }
  return fontes;
}

export function saldoTotal(eventos) {
  return Object.values(saldoPorFonte(eventos)).reduce((soma, f) => soma + f.valor, 0);
}

/** Saldo do dia num instante — a base de tudo o que se mede por diferença. */
export function saldoEm(eventos, ate) {
  return saldoTotal((eventos || []).filter((e) => e.timestamp <= ate));
}

/**
 * Ganho desta jornada: quanto o saldo do dia subiu desde a abertura dela.
 *
 * A declaração de abertura tem o mesmo timestamp da jornada, então entra nos
 * dois lados da subtração e se cancela — é exatamente o que se quer: ela diz
 * de onde a jornada parte, não o que ela produziu.
 */
export function ganhoDaJornada(eventos, jornada, ate = Infinity) {
  if (!jornada) return 0;
  return saldoEm(eventos, ate) - saldoEm(eventos, jornada.horaInicio);
}

/**
 * A janela de uma jornada dentro do dia: do início dela até a abertura da
 * seguinte (ou até o fechamento, se for a última).
 *
 * A declaração de abertura da jornada SEGUINTE fica de fora de propósito. Ela
 * diz onde o dia estava quando o próximo turno começou — possivelmente horas
 * depois, com o motorista em casa. Atribuir esse salto à jornada anterior
 * inflaria o R$/hora dela com dinheiro que ela não produziu.
 *
 * O efeito colateral é que a soma dos ganhos das jornadas pode não fechar com o
 * total do dia. Isso é honesto: dinheiro que apareceu entre turnos não é de
 * nenhum dos dois.
 */
export function janelaDaJornada(jornadas, registros, jornada) {
  const doDia = (jornadas || [])
    .filter((j) => j.data === jornada.data)
    .sort((a, b) => a.horaInicio - b.horaInicio);
  const proxima = doDia.find((j) => j.horaInicio > jornada.horaInicio) || null;
  const ate = proxima ? proxima.horaInicio : (jornada.horaFim ?? Date.now());

  const eventos = eventosDoDia(doDia, registros).filter(
    (e) => !(proxima && e.id === `abertura-${proxima.id}`)
  );

  return {
    eventos,
    proxima,
    ate,
    ganho: ganhoDaJornada(eventos, jornada, ate),
    fontesFim: saldoPorFonte(eventos.filter((e) => e.timestamp <= ate)),
  };
}

function ordenados(eventos) {
  return [...(eventos || [])].sort((a, b) => a.timestamp - b.timestamp);
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
 * O km vem só do odômetro do painel, digitado. A medição por GPS foi removida
 * depois de errar por mais da metade numa noite real: o navegador suspende a
 * geolocalização quando o app sai de primeiro plano, e o motorista passa a
 * jornada dentro do app da plataforma.
 *
 * Sem odômetro digitado o km fica em zero e as métricas que dependem dele
 * mostram "—". É de propósito: melhor não ter número do que ter um inventado.
 */
export function kmPercorrido(jornada, registros) {
  return kmAte(jornada, registros, Infinity);
}

/** Km percorrido até um instante, para medir a janela do bloco. */
export function kmAte(jornada, registros, ate = Infinity) {
  if (!jornada) return 0;
  const pontos = aceitos(pontosDeOdometro(jornada, registros, ate));
  if (pontos.length < 2) return 0;
  return pontos[pontos.length - 1].valor - pontos[0].valor;
}

/** Nenhuma jornada urbana sustenta 120 km/h de média. */
const KMH_IMPOSSIVEL = 120;

/**
 * Descarta o ponto que anda para trás ou que exigiria velocidade impossível
 * desde o ponto anterior: isso é dedo errado no teclado, nao medição. Dizer
 * "sem km" é melhor do que envenenar o R$/km e o líquido com um número que
 * parece leitura de painel.
 */
function aceitos(pontos) {
  const bons = [];
  for (const ponto of pontos) {
    const antes = bons[bons.length - 1];
    if (antes) {
      const horas = Math.max(0.5, (ponto.quando - antes.quando) / HORA);
      const avanco = ponto.valor - antes.valor;
      if (avanco < 0 || avanco > horas * KMH_IMPOSSIVEL) continue;
    }
    bons.push(ponto);
  }
  return bons;
}

/**
 * Um odômetro de painel nunca é zero, negativo ou NaN. Quando aparece assim é
 * campo em branco que virou número no caminho — Number(null) e Number("") dao
 * 0, Number(undefined) da NaN — e usar isso como base faz o "percorrido" virar
 * a quilometragem inteira do carro.
 */
function odometroValido(valor) {
  return Number.isFinite(valor) && valor > 0;
}

/** Abertura, âncoras digitadas e fechamento, em ordem de relógio. */
function pontosDeOdometro(jornada, registros, ate = Infinity) {
  const pontos = [];
  if (odometroValido(jornada.odometroInicio)) {
    pontos.push({ quando: jornada.horaInicio, valor: jornada.odometroInicio });
  }
  for (const r of registrosValidos(registros)) {
    if (r.timestamp <= ate && odometroValido(r.odometro)) {
      pontos.push({ quando: r.timestamp, valor: r.odometro });
    }
  }
  const fim = jornada.horaFim ?? Infinity;
  if (fim <= ate && odometroValido(jornada.odometroFim)) {
    pontos.push({ quando: fim, valor: jornada.odometroFim });
  }
  return pontos.sort((a, b) => a.quando - b.quando);
}

/** Quantas âncoras de odômetro o motorista digitou nesta jornada. */
export function ancorasOdometro(registros) {
  return registrosValidos(registros).filter((r) => odometroValido(r.odometro)).length;
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

/**
 * Métricas ao vivo da tela principal, em três escalas:
 *  - dia: o acumulado, que é o que importa para a meta;
 *  - bloco: a janela recente, que é o que importa para decidir ficar ou mudar.
 *
 * A distinção existe porque média acumulada tem memória: na oitava hora, o
 * número do dia já está quase todo decidido pelo passado e mal reage ao que
 * está acontecendo agora. Um começo fraco faz o dia inteiro parecer ruim
 * mesmo quando o pedaço atual está ótimo — e o contrário também.
 */
export function metricasAoVivo({
  jornada,
  eventos,
  registros,
  pausas,
  config,
  agora = Date.now(),
}) {
  const validos = registrosValidos(registros);
  // Dinheiro registrado NAO se corta em "agora". Um checkpoint que existe já
  // foi ganho — se o relógio do aparelho recuar (sincronia de rede, fuso,
  // acerto manual), cortar a linha do tempo faria o saldo do dia sumir da
  // tela até o relógio alcançar de novo. Só janela — bloco, projeção — tem
  // motivo para olhar o instante.
  const saldoDia = saldoTotal(eventos);
  const ganho = ganhoDaJornada(eventos, jornada);
  const ativo = msAtivo(jornada, pausas, agora);
  const km = kmPercorrido(jornada, validos);

  const rh = reaisPorHora(ganho, ativo);
  const rk = reaisPorKm(ganho, km);
  const faixaKm = faixaKmDe(agora, config.faixasKm);
  // A faixa de R$/hora também é do período: a hora do pico nao vale o mesmo
  // que a das dez da manhã, e uma faixa única fazia as duas parecerem iguais.
  const faixaHora = faixaKmDe(agora, config.faixasHora || {}) || config.faixaHora;

  const janela = bloco({
    jornada,
    eventos,
    registros: validos,
    pausas,
    duracaoMs: (config.blocoMin || 120) * MINUTO,
    agora,
  });

  return {
    saldo: saldoDia,
    ganho,
    // Onde o dia estava quando esta jornada abriu.
    base: saldoDia - ganho,
    fontes: saldoPorFonte(eventos),
    msAtivo: ativo,
    msRua: msRua(jornada, agora),
    msPausado: msPausado(pausas, agora),
    km,
    ancoras: ancorasOdometro(validos),
    reaisPorHora: rh,
    reaisPorKm: rk,
    nivelHora: nivel(rh, faixaHora),
    nivelKm: nivel(rk, faixaKm),
    bloco: janela
      ? {
          ...janela,
          nivelHora: nivel(janela.reaisPorHora, faixaHora),
          nivelKm: nivel(janela.reaisPorKm, faixaKm),
        }
      : null,
    faixaKm,
    faixaHora,
    periodo: periodoDe(agora),
    emPausa: !!pausaAberta(pausas),
  };
}

/* ------------------------------------------------------------------ bloco */

const MIN_ATIVO_BLOCO = 30 * MINUTO;

/**
 * Janela deslizante ancorada no checkpoint mais próximo do início dela.
 *
 * Duas decisões que valem explicação:
 *
 * 1. Deslizante, não bloco fixo de relógio. Um bloco fixo reseta a cada duas
 *    horas e, com checkpoint a cada 1–2h, ficaria vazio boa parte do tempo.
 *
 * 2. O tempo é medido até o último checkpoint, não até agora. O número do dia
 *    é ritmo (a hora ociosa conta contra a meta, e deve mesmo); o bloco é
 *    desempenho medido, e só o intervalo entre checkpoints foi medido. Se
 *    contasse até agora, o bloco despencaria enquanto ele roda sem registrar —
 *    justamente o contrário do que a métrica serve para mostrar.
 */
export function bloco({ jornada, eventos, registros, pausas, duracaoMs, agora = Date.now() }) {
  const validos = registrosValidos(registros);
  if (!jornada || !validos.length) return null;

  const inicioJanela = agora - duracaoMs;
  const ultimo = validos[validos.length - 1];
  // Nenhum registro dentro da janela: não há o que medir.
  if (ultimo.timestamp <= inicioJanela) return null;

  const ancora = [...validos].reverse().find((r) => r.timestamp <= inicioJanela) || null;
  const inicio = ancora ? ancora.timestamp : jornada.horaInicio;

  const linha = eventos || validos;
  const delta = saldoEm(linha, ultimo.timestamp) - saldoEm(linha, inicio);

  const ativo = Math.max(0, ultimo.timestamp - inicio - msPausadoEntre(pausas, inicio, ultimo.timestamp));
  const km = Math.max(0, kmAte(jornada, validos, ultimo.timestamp) - kmAte(jornada, validos, inicio));

  return {
    delta,
    inicio,
    fim: ultimo.timestamp,
    msAtivo: ativo,
    km,
    reaisPorHora: ativo >= MIN_ATIVO_BLOCO ? reaisPorHora(delta, ativo) : null,
    reaisPorKm: ativo >= MIN_ATIVO_BLOCO ? reaisPorKm(delta, km) : null,
    // Janela magra produz número espetacular e falso; melhor mostrar "—".
    confiavel: ativo >= MIN_ATIVO_BLOCO,
  };
}

/* ---------------------------------------------------------------- corridas */

/**
 * Corrida encerrada no cronômetro mas ainda sem valor lançado. Existe de
 * propósito: dirigindo, o que dá para fazer é marcar começo e fim; digitar o
 * valor é para o próximo semáforo. Ela guarda duração e trajeto, e fica fora
 * de toda média até o valor chegar — senão puxaria o R$/corrida para baixo.
 */
export function corridaPendente(corrida) {
  return corrida?.pendente === true || !(Number(corrida?.valorBruto) > 0);
}

export function corridasValidas(corridas) {
  return [...(corridas || [])].filter((c) => !corridaPendente(c)).sort((a, b) => a.timestamp - b.timestamp);
}

export function corridasPendentes(corridas) {
  return [...(corridas || [])].filter(corridaPendente).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Quanto o trajeto de rua é maior que a linha reta, medido nas corridas em que
 * ele digitou o km de verdade. Sem amostra vale 1,35, que é a razão típica em
 * malha urbana — e a tela sempre diz que o número é estimativa.
 */
export function fatorSinuosidade(corridas) {
  const razoes = (corridas || [])
    .filter((c) => c.kmLinhaReta > 0.3 && c.km > 0)
    .map((c) => c.km / c.kmLinhaReta)
    .filter((r) => r >= 1 && r <= 3)
    .sort((a, b) => a - b);
  if (razoes.length < 5) return 1.35;
  return razoes[Math.floor(razoes.length / 2)];
}

export function somaCorridas(corridas) {
  return corridasValidas(corridas).reduce((soma, c) => soma + (Number(c.valorBruto) || 0), 0);
}

/**
 * Bruto do dia. Os checkpoints mandam quando existem — eles vêm do total da
 * propria plataforma, entao sao a verdade. As corridas so respondem pelo dia
 * quando nao ha checkpoint nenhum (caso do historico importado da planilha).
 * Somar os dois contaria o mesmo dinheiro duas vezes.
 */
export function brutoDoDia(eventos, corridas) {
  const comSaldo = (eventos || []).filter((e) => !e.desfeito && (e.saldos || e.avulso));
  if (comSaldo.length) return saldoTotal(comSaldo);
  return somaCorridas(corridas);
}

/**
 * Confere o lançamento de corridas contra o saldo dos checkpoints. Uma
 * diferença grande normalmente significa corrida esquecida no lançamento.
 */
export function conferenciaCorridas(registros, corridas, ganho = null) {
  const validos = registrosValidos(registros);
  if (!validos.length || !(corridas || []).length) return null;
  const saldo = ganho != null ? ganho : saldoTotal(validos);
  const somado = somaCorridas(corridas);
  const diferenca = saldo - somado;
  return {
    saldo,
    somado,
    diferenca,
    // 5% ou R$ 10 de folga cobrem gorjeta e arredondamento.
    fecha: Math.abs(diferenca) <= Math.max(10, saldo * 0.05),
  };
}

/** Quilometragem paga (dentro de corrida) sobre a quilometragem total rodada. */
export function aproveitamentoKm(corridas, kmJornada) {
  const kmPago = corridasValidas(corridas).reduce((s, c) => s + (Number(c.km) || 0), 0);
  if (!(kmJornada > 0)) return { kmPago, kmTotal: kmJornada, fracao: null };
  return { kmPago, kmTotal: kmJornada, fracao: kmPago / kmJornada };
}

/**
 * R$/km real da corrida: inclui o deslocamento feito para buscar o passageiro.
 * É o número que a planilha nao consegue calcular, e o que de fato responde se
 * a corrida valeu a pena.
 */
export function reaisPorKmReal(corrida) {
  const km = (Number(corrida.km) || 0) + (Number(corrida.kmDeslocamento) || 0);
  return km > 0 ? corrida.valorBruto / km : null;
}

/** Lista de bairros já usados, mais frequentes primeiro (para o autocomplete). */
export function bairrosUsados(corridas) {
  const contagem = new Map();
  for (const c of corridas || []) {
    for (const bairro of [c.bairroOrigem, c.bairroDestino]) {
      const nome = (bairro || "").trim();
      if (!nome || nome === "?") continue;
      contagem.set(nome, (contagem.get(nome) || 0) + 1);
    }
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([nome]) => nome);
}

/* ------------------------------------------------------------------ trecho */

/**
 * Desempenho entre os dois ultimos checkpoints. É o que o toast mostra logo
 * depois de confirmar um registro.
 */
export function ultimoTrecho(jornada, registros, pausas, eventos = null) {
  const validos = registrosValidos(registros);
  if (validos.length === 0) return null;

  const atual = validos[validos.length - 1];
  const anterior = validos.length > 1 ? validos[validos.length - 2] : null;

  const inicio = anterior ? anterior.timestamp : jornada.horaInicio;
  const linha = eventos || validos;
  const saldoInicio = saldoEm(linha, inicio);
  const saldoFim = saldoEm(linha, atual.timestamp);

  const bruto = atual.timestamp - inicio;
  const pausado = msPausadoEntre(pausas, inicio, atual.timestamp);
  const ativo = Math.max(0, bruto - pausado);

  const kmInicio = anterior ? kmAte(jornada, validos, anterior.timestamp) : 0;
  const kmFim = kmAte(jornada, validos, atual.timestamp);

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

/** Tempo ativo mínimo para extrapolar o resto da noite a partir do ritmo. */
export const MIN_ATIVO_PROJECAO = 30 * MINUTO;

export function projecao(saldo, alvo, ritmo, agora = Date.now()) {
  if (ritmo == null || ritmo <= 0) return null;
  if (saldo >= alvo) return { quando: agora, jaAtingido: true };
  const faltamMs = ((alvo - saldo) / ritmo) * HORA;
  return { quando: agora + faltamMs, faltamMs, jaAtingido: false };
}

/**
 * O que o ritmo atual entrega, em números.
 *
 * Duas grandezas diferentes entram aqui e não podem se misturar:
 *
 *  - `saldo` é o do DIA, e é dele que a meta parte;
 *  - `ganho`/`msAtivos` são desta JORNADA, e é deles que sai o ritmo.
 *
 * Dividir o saldo do dia pelo tempo da jornada foi exatamente o defeito que
 * projetava R$1.747 numa noite de R$32/h: a jornada tinha 13 minutos e
 * carregava os R$178 ganhos antes dela.
 *
 * O piso de meia hora existe porque extrapolar horas a partir de minutos é
 * ruído, mesmo com a conta certa.
 */
export function projecaoDetalhada({ saldo, ganho, msAtivos, metas, horaLimite, agora = Date.now() }) {
  const alvo = proximoPatamar(saldo, metas);
  if (!alvo) return { tipo: "completa", saldo };

  const ritmo = msAtivos >= MIN_ATIVO_PROJECAO ? reaisPorHora(ganho, msAtivos) : null;
  if (ritmo == null || ritmo <= 0) {
    return { tipo: "sem_ritmo", alvo, falta: alvo.alvo - saldo, msAtivos };
  }

  const limite = new Date(agora);
  limite.setHours(horaLimite, 0, 0, 0);
  // Hora limite antes do instante atual significa madrugada adentro: é amanhã.
  if (limite.getTime() <= agora) limite.setDate(limite.getDate() + 1);

  const horasRestantes = (limite.getTime() - agora) / HORA;
  const projetado = saldo + ritmo * horasRestantes;
  const falta = alvo.alvo - saldo;
  const ritmoNecessario = horasRestantes > 0 ? falta / horasRestantes : Infinity;

  return {
    tipo: projetado >= alvo.alvo ? "alcancavel" : "aperto",
    alvo,
    ritmo,
    ritmoNecessario,
    projetado,
    falta,
    horasRestantes,
    limite: limite.getTime(),
    chegaEm: projecao(saldo, alvo.alvo, ritmo, agora)?.quando ?? null,
  };
}

/* ----------------------------------------------------------- combustivel */

export const TIPOS_COMBUSTIVEL = ["gnv", "gasolina", "etanol"];

export function ehCombustivel(tipo) {
  return TIPOS_COMBUSTIVEL.includes(tipo);
}

/**
 * Custo real de energia por km, medido de bomba a bomba.
 *
 * Convenção de tanque cheio: o combustível colocado num abastecimento é o que
 * roda até o próximo. Por isso o gasto conta do segundo abastecimento em
 * diante, enquanto a distância conta do primeiro ao último — usar o primeiro
 * abastecimento no numerador contaria combustível queimado antes da medição.
 *
 * O consumo separado por combustível é impossível de medir num carro
 * bicombustível que alterna no meio do trajeto: só sai quando dois
 * abastecimentos seguidos são do mesmo tipo. O custo por km agregado, por
 * outro lado, não precisa separar nada — e é ele que alimenta o break-even.
 */
export function analiseAbastecimentos(custos) {
  const cheios = (custos || [])
    .filter((c) => ehCombustivel(c.tipo) && c.odometro > 0 && c.valor > 0)
    .sort((a, b) => a.odometro - b.odometro);

  if (cheios.length < 2) {
    return { suficiente: false, abastecimentos: cheios.length, porKm: null, consumos: {} };
  }

  const kmPeriodo = cheios[cheios.length - 1].odometro - cheios[0].odometro;
  const gasto = cheios.slice(1).reduce((soma, c) => soma + c.valor, 0);
  if (!(kmPeriodo > 0)) {
    return { suficiente: false, abastecimentos: cheios.length, porKm: null, consumos: {} };
  }

  // km por litro/m³, só entre abastecimentos seguidos do mesmo combustível.
  const consumos = {};
  for (let i = 1; i < cheios.length; i++) {
    const antes = cheios[i - 1];
    const agora = cheios[i];
    if (antes.tipo !== agora.tipo || !(agora.litros > 0)) continue;
    const km = agora.odometro - antes.odometro;
    if (km <= 0) continue;
    (consumos[agora.tipo] ||= []).push(km / agora.litros);
  }

  const medias = {};
  for (const [tipo, lista] of Object.entries(consumos)) {
    medias[tipo] = { media: lista.reduce((a, b) => a + b, 0) / lista.length, amostras: lista.length };
  }

  return {
    suficiente: true,
    abastecimentos: cheios.length,
    kmPeriodo,
    gasto,
    porKm: gasto / kmPeriodo,
    primeiro: cheios[0].timestamp,
    ultimo: cheios[cheios.length - 1].timestamp,
    consumos: medias,
  };
}

/** Gastos que não são energia (pedágio, alimentação, lavagem, manutenção). */
export function outrosCustos(custos) {
  return (custos || []).filter((c) => !ehCombustivel(c.tipo)).reduce((soma, c) => soma + (c.valor || 0), 0);
}

/* ---------------------------------------------------------------- dinheiro */

/**
 * `energiaKmMedido` vem dos abastecimentos reais quando existem dois ou mais.
 * Enquanto não existem, valem os valores semeados nas configurações.
 */
export function custosEstimados(km, config, energiaKmMedido = null) {
  const fatiaGnv = Math.min(100, Math.max(0, config.mixGnvPct)) / 100;
  const porKmGnv = config.kmPorM3 > 0 ? config.precoGnv / config.kmPorM3 : 0;
  const porKmEtanol = config.kmPorLitro > 0 ? config.precoEtanol / config.kmPorLitro : 0;
  const energiaKm =
    energiaKmMedido > 0 ? energiaKmMedido : fatiaGnv * porKmGnv + (1 - fatiaGnv) * porKmEtanol;
  const desgasteKm = config.custoDesgasteKm || 0;
  return {
    energiaKm,
    desgasteKm,
    medido: energiaKmMedido > 0,
    totalKm: energiaKm + desgasteKm,
    energia: energiaKm * km,
    desgaste: desgasteKm * km,
    total: (energiaKm + desgasteKm) * km,
  };
}

export function liquidoEstimado(saldo, km, config, energiaKmMedido = null) {
  return saldo - custosEstimados(km, config, energiaKmMedido).total;
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
