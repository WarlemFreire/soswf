// modelo.js — o aprendizado de verdade. Roda no aparelho, offline, e não gasta
// token nenhum.
//
// POR QUE ISTO SUBSTITUI MANDAR HISTÓRICO PARA O MODELO DE LINGUAGEM. Mandar
// mais dado a cada pergunta não é aprender: é reler. O custo cresce com o
// histórico, a resposta não melhora na mesma proporção, e nada do que foi
// concluído sobrevive até a próxima chamada. Um app que melhora com o uso
// precisa guardar o que aprendeu em NÚMEROS, não em texto.
//
// O QUE ELE APRENDE: quanto você rende por hora, dado o contexto (período do
// dia, dia da semana, hora, região). Cada trecho de ganho que você fecha é uma
// observação; cada observação ajusta os pesos. Em um ano são milhares de
// observações e a memória continua do MESMO TAMANHO.
//
// O ALGORITMO É LinUCB -- regressão de crista com limite de confiança superior.
// Escolhido por três razões, nesta ordem:
//
//   1. Ele carrega INCERTEZA junto com a previsão. "Acho que rende 50, e tenho
//      certeza" é diferente de "acho que rende 50, e nunca estive lá". Sem
//      isso, o app recomendaria com confiança um lugar onde você foi uma vez.
//
//   2. Ele EXPLORA de propósito. Um modelo que só recomenda o que já conhece
//      nunca descobre que a região 7 era melhor -- ele se tranca no que
//      aprendeu no primeiro mês. O limite de confiança faz o pouco visitado
//      valer uma visita, e isso é o que torna o app melhor daqui a um ano.
//
//   3. Ele atualiza em O(d²) por observação, com d na casa de vinte. É
//      aritmética de microssegundos, sem servidor e sem biblioteca.
//
// MEMÓRIA CONSTANTE, E ISSO É O PONTO. O que fica guardado é uma matriz d×d e
// um vetor d. Depois de dez observações e depois de dez mil, o tamanho é
// exatamente o mesmo.

import * as M from "./metrics.js";
import { PERIODOS } from "./config.js";

/** Teto de regiões com peso próprio. O resto cai num balde "outra". */
export const MAX_REGIOES = 12;

/** Regularização da crista. Segura o modelo enquanto há pouco dado. */
const LAMBDA = 1;

/**
 * Quanto a incerteza pesa na escolha.
 *
 * Alto demais e ele vive explorando e nunca colhe; baixo demais e ele se
 * tranca no primeiro lugar razoável que achou. 0,6 dá um empurrão real para o
 * pouco visitado sem mandar você atravessar a cidade por um palpite.
 */
export const ALFA = 0.6;

/** Abaixo disto o modelo não opina: diz que ainda não sabe. */
export const MINIMO_OBSERVACOES = 25;

/* ---------------------------------------------------------- o contexto */

/**
 * O vetor de características de uma situação.
 *
 * Deliberadamente pequeno. Cada coluna a mais exige mais observações para o
 * modelo se firmar, e observação aqui custa um turno inteiro de trabalho --
 * não é dado de graça.
 */
export function caracteristicas({ quando, regiao = null }, regioes = []) {
  const d = new Date(quando);
  const hora = d.getHours() + d.getMinutes() / 60;
  const diaSemana = d.getDay();

  const x = new Array(dimensao()).fill(0);
  let i = 0;

  x[i++] = 1; // intercepto

  // Período do dia, como o resto do app já classifica.
  const periodo = M.periodoDe(quando);
  for (const p of PERIODOS) x[i++] = p.id === periodo ? 1 : 0;

  // Fim de semana muda a cidade inteira.
  x[i++] = diaSemana === 0 || diaSemana === 6 ? 1 : 0;

  // Hora como ciclo: 23h e 0h são vizinhas, e um número cru de 0 a 23 diria
  // que estão a 23 de distância.
  x[i++] = Math.sin((2 * Math.PI * hora) / 24);
  x[i++] = Math.cos((2 * Math.PI * hora) / 24);

  // Região, uma coluna cada, com balde para o excedente.
  const pos = regiao == null ? -1 : regioes.indexOf(regiao);
  for (let k = 0; k < MAX_REGIOES; k++) x[i + k] = pos === k ? 1 : 0;
  i += MAX_REGIOES;
  x[i++] = regiao != null && pos < 0 ? 1 : 0; // outra região

  return x;
}

export function dimensao() {
  return 1 + PERIODOS.length + 1 + 2 + MAX_REGIOES + 1;
}

/* ------------------------------------------------------------ o modelo */

/**
 * Um modelo zerado.
 *
 * `inversa` é a inversa da matriz de crista, mantida direto em vez de
 * recalculada: a atualização de Sherman-Morrison ajusta a inversa em O(d²), e
 * inverter do zero a cada observação seria O(d³) sem necessidade.
 */
export function novoModelo() {
  const d = dimensao();
  return {
    versao: 1,
    d,
    inversa: identidade(d, 1 / LAMBDA),
    b: new Array(d).fill(0),
    regioes: [],
    n: 0,
    // Erro médio do modelo e de um palpite burro (a média de tudo). Sem a
    // comparação, "o erro é 8" não diz se o modelo serve para alguma coisa.
    somaErro: 0,
    somaErroBase: 0,
    avaliadas: 0,
    media: 0,
    m2: 0,
  };
}

/** Garante uma coluna para a região, até o teto. */
export function registrarRegiao(modelo, regiao) {
  if (regiao == null) return modelo;
  if (modelo.regioes.includes(regiao)) return modelo;
  if (modelo.regioes.length >= MAX_REGIOES) return modelo;
  modelo.regioes = [...modelo.regioes, regiao];
  return modelo;
}

/**
 * Uma observação. `y` é o R$/h medido naquele trecho.
 *
 * A avaliação acontece ANTES do treino, com a previsão que o modelo faria sem
 * ter visto este caso -- é a única forma honesta de medir se ele aprendeu, em
 * vez de medir se ele decorou.
 */
export function treinar(modelo, contexto, y) {
  if (!Number.isFinite(y)) return modelo;

  registrarRegiao(modelo, contexto.regiao);
  const x = caracteristicas(contexto, modelo.regioes);

  if (modelo.n >= MINIMO_OBSERVACOES) {
    const previsto = produto(pesos(modelo), x);
    modelo.somaErro += Math.abs(previsto - y);
    modelo.somaErroBase += Math.abs(modelo.media - y);
    modelo.avaliadas += 1;
  }

  // Média corrente de y (Welford), que é o palpite burro de comparação.
  modelo.n += 1;
  const delta = y - modelo.media;
  modelo.media += delta / modelo.n;
  modelo.m2 += delta * (y - modelo.media);

  // Sherman-Morrison: inversa ← inversa − (inversa·x·xᵀ·inversa)/(1 + xᵀ·inversa·x)
  const ax = multiplicar(modelo.inversa, x);
  const denominador = 1 + produto(x, ax);
  if (!(Math.abs(denominador) > 1e-9)) return modelo;

  for (let i = 0; i < modelo.d; i++) {
    for (let j = 0; j < modelo.d; j++) {
      modelo.inversa[i][j] -= (ax[i] * ax[j]) / denominador;
    }
  }
  for (let i = 0; i < modelo.d; i++) modelo.b[i] += y * x[i];

  return modelo;
}

/** θ = inversa · b */
export function pesos(modelo) {
  return multiplicar(modelo.inversa, modelo.b);
}

/**
 * Previsão para um contexto, com a incerteza junto.
 *
 * `confianca` baixa quer dizer "nunca estive muito nessa situação". A tela e o
 * assistente precisam disso para não recomendar com cara de certeza algo que
 * saiu de duas observações.
 */
export function prever(modelo, contexto) {
  const x = caracteristicas(contexto, modelo.regioes);
  const media = produto(pesos(modelo), x);
  const variancia = Math.max(0, produto(x, multiplicar(modelo.inversa, x)));
  const incerteza = Math.sqrt(variancia);

  return {
    reaisPorHora: media,
    incerteza,
    // Nota de 0 a 1, para a tela não ter que explicar desvio-padrão.
    confianca: 1 / (1 + incerteza * 4),
    pronto: modelo.n >= MINIMO_OBSERVACOES,
  };
}

/**
 * Escolhe entre opções, equilibrando o que rende e o que falta conhecer.
 *
 * O limite de confiança superior é o que faz o app melhorar com o tempo em vez
 * de se trancar: a opção pouco visitada ganha um bônus proporcional à própria
 * ignorância, e visitá-la reduz esse bônus. Sem isso, a primeira região boa
 * vira a única região para sempre.
 */
export function escolher(modelo, opcoes, { alfa = ALFA } = {}) {
  const avaliadas = (opcoes || []).map((o) => {
    const p = prever(modelo, o);
    return {
      ...o,
      ...p,
      // O valor que decide: previsão mais o bônus da incerteza.
      pontuacao: p.reaisPorHora + alfa * p.incerteza,
      explorando: p.incerteza > 0.35,
    };
  });

  return avaliadas.sort((a, b) => b.pontuacao - a.pontuacao);
}

/* --------------------------------------------------------- ele aprendeu? */

/**
 * O modelo está batendo o palpite burro?
 *
 * Esta função existe para o app poder dizer "ainda não confio em mim". Um
 * modelo que erra mais que a média simples não deve recomendar nada, e deixar
 * isso implícito seria o mesmo que inventar número.
 */
export function desempenho(modelo) {
  if (!modelo || modelo.avaliadas < 10) {
    return { pronto: false, avaliadas: modelo?.avaliadas ?? 0, erro: null, erroBase: null, ganhoPct: null };
  }

  const erro = modelo.somaErro / modelo.avaliadas;
  const erroBase = modelo.somaErroBase / modelo.avaliadas;
  const ganho = erroBase > 0 ? ((erroBase - erro) / erroBase) * 100 : 0;

  return {
    pronto: true,
    avaliadas: modelo.avaliadas,
    erro: arredondar(erro, 2),
    erroBase: arredondar(erroBase, 2),
    ganhoPct: arredondar(ganho, 1),
    // Só vale dizer que aprendeu quando erra menos que a média simples.
    melhorQueAMedia: erro < erroBase,
    observacoes: modelo.n,
  };
}

/**
 * O resumo que vai para o assistente.
 *
 * É ISTO que substitui mandar o histórico inteiro: algumas dezenas de números
 * em vez de centenas de linhas, e o tamanho não cresce com o uso.
 */
export function resumo(modelo, agora = Date.now()) {
  const d = desempenho(modelo);
  const opcoes = modelo.regioes.map((regiao) => ({ quando: agora, regiao }));

  return {
    observacoes: modelo.n,
    desempenho: d,
    mediaGeral: arredondar(modelo.media, 2),
    // As previsões só saem quando o modelo já erra menos que a média simples.
    // Mandá-las junto de "ainda não sou confiável" seria convidar a usá-las
    // assim mesmo -- a mesma razão de o app mostrar travessão em vez de zero.
    agora: d.pronto && d.melhorQueAMedia
      ? escolher(modelo, opcoes).slice(0, 4).map((o, i) => ({
          regiao: `região ${modelo.regioes.indexOf(o.regiao) + 1}`,
          previsaoReaisPorHora: arredondar(o.reaisPorHora, 1),
          confianca: arredondar(o.confianca, 2),
          vaiExplorar: o.explorando && i === 0,
        }))
      : null,
  };
}

/* -------------------------------------------------- guardar e recarregar */

/** Para o banco. Tamanho fixo, independente de quantas observações entraram. */
export function serializar(modelo) {
  return {
    versao: modelo.versao,
    d: modelo.d,
    // Achatada: matriz aninhada em JSON triplica o tamanho com colchetes.
    inversa: modelo.inversa.flat(),
    b: modelo.b,
    regioes: modelo.regioes,
    n: modelo.n,
    somaErro: modelo.somaErro,
    somaErroBase: modelo.somaErroBase,
    avaliadas: modelo.avaliadas,
    media: modelo.media,
    m2: modelo.m2,
  };
}

export function desserializar(bruto) {
  if (!bruto || bruto.d !== dimensao() || bruto.versao !== 1) {
    // Mudou a forma das características: o modelo velho não descreve mais o
    // mesmo mundo. Recomeçar é mais honesto que reaproveitar pesos errados.
    return novoModelo();
  }
  const m = novoModelo();
  m.inversa = desachatar(bruto.inversa, bruto.d);
  m.b = bruto.b.slice();
  m.regioes = (bruto.regioes || []).slice();
  m.n = bruto.n || 0;
  m.somaErro = bruto.somaErro || 0;
  m.somaErroBase = bruto.somaErroBase || 0;
  m.avaliadas = bruto.avaliadas || 0;
  m.media = bruto.media || 0;
  m.m2 = bruto.m2 || 0;
  return m;
}

/* ------------------------------------------------------------- álgebra */

function identidade(d, valor) {
  return Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? valor : 0))
  );
}

function multiplicar(matriz, vetor) {
  const d = vetor.length;
  const saida = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    let soma = 0;
    const linha = matriz[i];
    for (let j = 0; j < d; j++) soma += linha[j] * vetor[j];
    saida[i] = soma;
  }
  return saida;
}

function produto(a, b) {
  let soma = 0;
  for (let i = 0; i < a.length; i++) soma += a[i] * b[i];
  return soma;
}

function desachatar(plana, d) {
  return Array.from({ length: d }, (_, i) => plana.slice(i * d, (i + 1) * d));
}

function arredondar(valor, casas) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
