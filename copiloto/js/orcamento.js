// orcamento.js — quanto cobrar numa corrida particular. Puro e testável.
//
// O ERRO QUE ESTE ARQUIVO EVITA é o motorista orçar pelo km da viagem e
// esquecer o resto do tempo que ela custa. Uma corrida particular de 20 km que
// leva 40 minutos não ocupa 40 minutos: ocupa o deslocamento até o cliente, a
// espera, a viagem e a volta vazia. Cobrar só pela viagem é trabalhar de graça
// no resto — e é exatamente por isso que particular costuma parecer melhor do
// que é.
//
// DUAS CONTAS, E VALE A MAIOR:
//
//   POR TEMPO   o tempo TOTAL ocupado × o quanto ele quer ganhar por hora.
//   POR CUSTO   o km TOTAL rodado × custo/km, mais a margem que ele quer.
//
// A maior das duas é o preço. Não é a média: a média aceitaria um preço que
// falha numa das duas restrições. Se o tempo manda, a corrida é demorada para
// a distância (trânsito, espera); se o custo manda, é longa e rápida.
//
// Nada aqui usa a faixa de R$/km da JORNADA. Aquela escala conta km vazio de
// um turno inteiro de aplicativo e não descreve uma corrida combinada. O alvo
// por hora é o mesmo R$/h que ele já mede -- esse sim é comparável.

import * as M from "./metrics.js";

/** Velocidade para estimar o tempo do retorno vazio, quando ele não informa. */
const KMH_RETORNO = 30;

/**
 * Arredonda para cima, no passo dado. Preço de particular é falado em voz alta:
 * "oitenta" fecha negócio, "setenta e sete e trinta" parece conta de mercado.
 * Para cima porque arredondar para baixo come a margem.
 */
export function arredondar(valor, passo = 5) {
  if (!(valor > 0) || !(passo > 0)) return 0;
  return Math.ceil(valor / passo) * passo;
}

/**
 * Orça uma corrida.
 *
 * @param {object} p
 * @param {number} p.km             km da viagem em si
 * @param {number} p.minutos        duração estimada da viagem
 * @param {number} [p.kmAteCliente] deslocamento até o embarque
 * @param {number} [p.minutosEspera] espera combinada no local
 * @param {boolean} [p.voltaVazio]  se volta sem passageiro (padrão: sim)
 * @param {object} p.config         config do app (custo por km)
 * @param {number} p.alvoHora       R$/h que ele quer nesta corrida
 * @param {number} [p.margemPct]    margem sobre o custo, na conta por custo
 * @param {number} [p.passo]        arredondamento
 */
export function orcar({
  km,
  minutos,
  kmAteCliente = 0,
  minutosEspera = 0,
  voltaVazio = true,
  config,
  alvoHora,
  margemPct = 100,
  passo = 5,
} = {}) {
  const kmViagem = num(km);
  const kmIda = num(kmAteCliente);
  // A volta vazia percorre a mesma distância da viagem: ele termina onde
  // deixou o cliente e precisa voltar para onde trabalha.
  const kmVolta = voltaVazio ? kmViagem : 0;
  const kmTotal = kmViagem + kmIda + kmVolta;

  if (!(kmViagem > 0) || !(num(minutos) > 0)) return null;

  const minutosIda = (kmIda / KMH_RETORNO) * 60;
  const minutosVolta = (kmVolta / KMH_RETORNO) * 60;
  const minutosTotal = num(minutos) + num(minutosEspera) + minutosIda + minutosVolta;

  const custoKm = M.custosEstimados(1, config || {}, null).totalKm;
  const custo = custoKm * kmTotal;

  const alvo = num(alvoHora);
  const porTempo = (minutosTotal / 60) * alvo;
  const porCusto = custo * (1 + Math.max(0, num(margemPct)) / 100);

  const bruto = Math.max(porTempo, porCusto);
  const preco = arredondar(bruto, passo);

  return {
    preco,
    manda: porTempo >= porCusto ? "tempo" : "custo",
    porTempo,
    porCusto,
    custo,
    custoKm,
    lucro: preco - custo,
    kmViagem,
    kmIda,
    kmVolta,
    kmTotal,
    minutosViagem: num(minutos),
    minutosEspera: num(minutosEspera),
    minutosMorto: minutosIda + minutosVolta,
    minutosTotal,
    // O que este preço rende de fato, já contando o tempo e o km mortos. É o
    // número comparável com o R$/h e o R$/km que ele mede na jornada.
    reaisPorHora: minutosTotal > 0 ? ((preco - custo) / minutosTotal) * 60 : null,
    reaisPorKmViagem: kmViagem > 0 ? preco / kmViagem : null,
  };
}

/**
 * Quanto ele costuma ganhar por hora, para servir de alvo inicial.
 *
 * Usa o percentil ideal da faixa do período, que é o que ele consegue num dia
 * bom -- não a mediana. Particular não tem algoritmo empurrando corrida: se ele
 * for cobrar, que seja pelo menos o que um dia bom de aplicativo paga.
 *
 * Sem histórico devolve null, e a tela pede o número em vez de inventar.
 */
export function alvoSugerido(referencia, agora = Date.now()) {
  const faixa = referencia?.[M.periodoDe(agora)]?.hora;
  return faixa?.ideal ?? null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
