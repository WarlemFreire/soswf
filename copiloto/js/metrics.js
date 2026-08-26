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
export function saldoPorFonte(registros, saldoInicial = {}) {
  const fontes = {};
  // A plataforma nao zera "ganhos de hoje" quando uma segunda jornada comeca.
  // A linha de base guarda onde a jornada anterior parou, para que o ganho
  // desta seja o que veio depois dela.
  for (const p of PLATAFORMAS) {
    const inicial = Number(saldoInicial?.[p.id]) || 0;
    fontes[p.id] = { valor: inicial, inicial, visto: null };
  }
  fontes.avulso = { valor: 0, inicial: 0, visto: null };

  for (const r of ordenados(registros)) {
    if (r.desfeito) continue;
    for (const [id, valor] of Object.entries(r.saldos || {})) {
      if (!(id in fontes) || valor == null) continue;
      fontes[id] = { valor: Number(valor), inicial: fontes[id].inicial, visto: r.timestamp };
    }
    if (r.avulso && r.avulso.valor != null) {
      fontes.avulso = {
        valor: fontes.avulso.valor + Number(r.avulso.valor),
        inicial: 0,
        visto: r.timestamp,
      };
    }
  }
  return fontes;
}

export function saldoTotal(registros, saldoInicial = {}) {
  const fontes = saldoPorFonte(registros, saldoInicial);
  return Object.values(fontes).reduce((soma, f) => soma + f.valor, 0);
}

/**
 * Ganho desta jornada: o que entrou depois da linha de base. É o numerador do
 * R$/hora e do R$/km — se contasse o saldo da jornada da manhã, a jornada da
 * tarde nasceria com um rendimento inflado que ela nao produziu.
 */
export function ganhoJornada(registros, saldoInicial = {}) {
  const fontes = saldoPorFonte(registros, saldoInicial);
  return Object.values(fontes).reduce((soma, f) => soma + (f.valor - f.inicial), 0);
}

/** Ganho da jornada considerando apenas registros até `ate` (inclusive). */
export function ganhoAte(registros, ate, saldoInicial = {}) {
  return ganhoJornada(
    registros.filter((r) => r.timestamp <= ate),
    saldoInicial
  );
}

/** Saldo total considerando apenas registros até `ate` (inclusive). */
export function saldoAte(registros, ate, saldoInicial = {}) {
  return saldoTotal(
    registros.filter((r) => r.timestamp <= ate),
    saldoInicial
  );
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
 * O km vem só do odômetro do painel, digitado. A medição por GPS foi removida
 * depois de errar por mais da metade numa noite real: o navegador suspende a
 * geolocalização quando o app sai de primeiro plano, e o motorista passa a
 * jornada dentro do app da plataforma.
 *
 * Sem odômetro digitado o km fica em zero e as métricas que dependem dele
 * mostram "—". É de propósito: melhor não ter número do que ter um inventado.
 */
export function kmPercorrido(jornada, registros) {
  if (!jornada || jornada.odometroInicio == null) return 0;
  return Math.max(0, ultimoOdometroConhecido(jornada, registros) - jornada.odometroInicio);
}

/** Km percorrido até um instante, para medir a janela do bloco. */
export function kmAte(jornada, registros, ate) {
  if (!jornada || jornada.odometroInicio == null) return 0;
  const ancora = ultimoOdometroConhecido(jornada, (registros || []).filter((r) => r.timestamp <= ate));
  return Math.max(0, ancora - jornada.odometroInicio);
}

function ultimoOdometroConhecido(jornada, registros) {
  let ancora = jornada.odometroInicio;
  for (const r of registrosValidos(registros)) {
    if (r.odometro != null) ancora = r.odometro;
  }
  // O odômetro final, quando existe, é a palavra final sobre o dia.
  if (jornada.odometroFim != null) ancora = jornada.odometroFim;
  return ancora;
}

/** Quantas âncoras de odômetro o motorista digitou nesta jornada. */
export function ancorasOdometro(registros) {
  return registrosValidos(registros).filter((r) => r.odometro != null).length;
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
  registros,
  pausas,
  config,
  baseDia = 0,
  agora = Date.now(),
}) {
  const validos = registrosValidos(registros);
  const saldoInicial = jornada?.saldoInicial || {};
  const ganho = ganhoJornada(validos, saldoInicial);
  const ativo = msAtivo(jornada, pausas, agora);
  const km = kmPercorrido(jornada, validos);

  const rh = reaisPorHora(ganho, ativo);
  const rk = reaisPorKm(ganho, km);
  const faixaKm = faixaKmDe(agora, config.faixasKm);

  const janela = bloco({
    jornada,
    registros: validos,
    pausas,
    saldoInicial,
    duracaoMs: (config.blocoMin || 120) * MINUTO,
    agora,
  });

  return {
    // Saldo do dia soma as jornadas anteriores; o ganho é só desta jornada.
    saldo: baseDia + ganho,
    ganho,
    baseDia,
    fontes: saldoPorFonte(validos, saldoInicial),
    msAtivo: ativo,
    msRua: msRua(jornada, agora),
    msPausado: msPausado(pausas, agora),
    km,
    ancoras: ancorasOdometro(validos),
    reaisPorHora: rh,
    reaisPorKm: rk,
    nivelHora: nivel(rh, config.faixaHora),
    nivelKm: nivel(rk, faixaKm),
    bloco: janela
      ? {
          ...janela,
          nivelHora: nivel(janela.reaisPorHora, config.faixaHora),
          nivelKm: nivel(janela.reaisPorKm, faixaKm),
        }
      : null,
    faixaKm,
    faixaHora: config.faixaHora,
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
export function bloco({ jornada, registros, pausas, saldoInicial = {}, duracaoMs, agora = Date.now() }) {
  const validos = registrosValidos(registros);
  if (!jornada || !validos.length) return null;

  const inicioJanela = agora - duracaoMs;
  const ultimo = validos[validos.length - 1];
  // Nenhum registro dentro da janela: não há o que medir.
  if (ultimo.timestamp <= inicioJanela) return null;

  const ancora = [...validos].reverse().find((r) => r.timestamp <= inicioJanela) || null;
  const inicio = ancora ? ancora.timestamp : jornada.horaInicio;

  const delta =
    ganhoAte(validos, ultimo.timestamp, saldoInicial) -
    (ancora ? ganhoAte(validos, ancora.timestamp, saldoInicial) : 0);

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

export function corridasValidas(corridas) {
  return [...(corridas || [])].sort((a, b) => a.timestamp - b.timestamp);
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
export function brutoDoDia(registros, corridas) {
  const validos = registrosValidos(registros);
  if (validos.length) return saldoTotal(validos);
  return somaCorridas(corridas);
}

/**
 * Confere o lançamento de corridas contra o saldo dos checkpoints. Uma
 * diferença grande normalmente significa corrida esquecida no lançamento.
 */
export function conferenciaCorridas(registros, corridas) {
  const validos = registrosValidos(registros);
  if (!validos.length || !(corridas || []).length) return null;
  const saldo = saldoTotal(validos);
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
export function ultimoTrecho(jornada, registros, pausas, saldoInicial = {}) {
  const validos = registrosValidos(registros);
  if (validos.length === 0) return null;

  const atual = validos[validos.length - 1];
  const anterior = validos.length > 1 ? validos[validos.length - 2] : null;

  const inicio = anterior ? anterior.timestamp : jornada.horaInicio;
  const saldoInicio = anterior ? ganhoAte(validos, anterior.timestamp, saldoInicial) : 0;
  const saldoFim = ganhoAte(validos, atual.timestamp, saldoInicial);

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

/**
 * O que o ritmo atual entrega, em números.
 *
 * A versão anterior dizia apenas "meta fora de alcance no ritmo atual" — um
 * veredito sem informação: não dizia quanto faltava, quanto tempo restava, nem
 * que ritmo seria preciso. Sem isso não dá para decidir se vale esticar o
 * turno, mudar de região ou baixar a meta.
 */
export function projecao(saldo, msAtivos, alvo, agora = Date.now()) {
  const rh = reaisPorHora(saldo, msAtivos);
  if (rh == null || rh <= 0) return null;
  if (saldo >= alvo) return { quando: agora, jaAtingido: true };
  const faltamMs = ((alvo - saldo) / rh) * HORA;
  return { quando: agora + faltamMs, faltamMs, jaAtingido: false };
}

export function projecaoDetalhada({ saldo, msAtivos, metas, horaLimite, agora = Date.now() }) {
  const alvo = proximoPatamar(saldo, metas);
  if (!alvo) return { tipo: "completa", saldo };

  const ritmo = reaisPorHora(saldo, msAtivos);
  if (ritmo == null || ritmo <= 0) return { tipo: "sem_ritmo", alvo };

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
    chegaEm: projecao(saldo, msAtivos, alvo.alvo, agora)?.quando ?? null,
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
