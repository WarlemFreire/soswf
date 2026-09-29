// rastreio.js — acumula quilometragem por GPS, só no app nativo.
//
// Isto existe porque anotar o odômetro nas duas pontas de cada trecho era o
// atrito que, na prática, fazia o km faltar -- e sem km metade das métricas de
// dinheiro mostra travessão.
//
// Na web este módulo não faz nada, e é proposital: o navegador suspende a
// geolocalização quando o app sai de primeiro plano, e o motorista passa a
// jornada dentro do app da plataforma. Medir ali dava menos da metade da
// distância real. No nativo existe serviço em primeiro plano, que é o que
// muda o jogo.
//
// TRÊS FILTROS, e cada um veio de um jeito específico de o GPS mentir:
//
// 1. PRECISÃO. Ponto com raio de erro grande é chute. Aceitar chute faz o
//    carro "andar" parado no semáforo, porque o erro passeia.
// 2. DESLOCAMENTO MÍNIMO. Mesmo com boa precisão o ponto tremula. Somar
//    tremulação acumula quilômetro sem sair do lugar -- o pior dos erros,
//    porque infla justamente quando o motorista está ganhando menos.
// 3. VELOCIDADE IMPOSSÍVEL. Salto de posição (recuperação de sinal, troca de
//    torre) apareceria como dezenas de km num segundo.
//
// A mesma ideia do filtro de plausibilidade do odômetro, e pela mesma razão:
// um número errado aqui contamina a decisão de aceitar corrida.

import { nativo } from "./plataforma.js";
import { distanciaKm } from "./geo.js";

/** Raio de erro acima disto é chute, não posição. */
const PRECISAO_MAX_M = 50;

/** Abaixo disto é tremulação do GPS, não deslocamento. */
const DESLOCAMENTO_MIN_M = 15;

/** Nenhum carro de aplicativo faz isso. Acima daqui é salto de sinal. */
const KMH_IMPOSSIVEL = 150;

/** De quanto em quanto tempo o acumulado vai para o banco. */
const SALVAR_CADA_MS = 30000;

let vigia = null;
let anterior = null;
let acumulado = 0;
let ultimoSalvoEm = 0;
let gravar = null;

function plugin() {
  return globalThis.Capacitor?.Plugins?.BackgroundGeolocation ?? null;
}

/** Se o rastreio pode funcionar neste aparelho. */
export function disponivel() {
  return nativo() && Boolean(plugin());
}

/**
 * Começa a acumular. `aoAcumular(km)` recebe o total da jornada em km sempre
 * que vale a pena gravar -- quem chama decide onde guardar.
 *
 * `kmInicial` retoma de onde parou, para reabrir o app no meio da jornada não
 * zerar o que já foi medido.
 */
export async function iniciar({ kmInicial = 0, aoAcumular } = {}) {
  if (!disponivel() || vigia) return false;

  acumulado = Number.isFinite(kmInicial) ? kmInicial : 0;
  ultimoSalvoEm = 0;
  anterior = null;
  gravar = aoAcumular;

  try {
    vigia = await plugin().addWatcher(
      {
        // Aparece na barra de notificação enquanto mede. O Android exige, e é
        // honesto: o motorista tem que saber que o GPS está ligado.
        backgroundTitle: "Copiloto medindo o km",
        backgroundMessage: "Toque para abrir. Encerre a jornada para desligar.",
        requestPermissions: true,
        stale: false,
        distanceFilter: DESLOCAMENTO_MIN_M,
      },
      (posicao, erro) => {
        if (erro || !posicao) return;
        receber(posicao);
      }
    );
    return true;
  } catch {
    vigia = null;
    return false;
  }
}

export async function parar() {
  if (!vigia) return acumulado;
  try {
    await plugin().removeWatcher({ id: vigia });
  } catch {
    /* já removido */
  }
  vigia = null;
  anterior = null;
  const total = acumulado;
  await salvar(true);
  gravar = null;
  return total;
}

export function estaRastreando() {
  return vigia != null;
}

export function kmAcumulado() {
  return acumulado;
}

/**
 * Um ponto do GPS. Exportada para os testes: é aqui que mora toda a decisão,
 * e ela precisa ser verificável sem aparelho.
 */
export function receber(posicao, agora = Date.now()) {
  if (!Number.isFinite(posicao?.latitude) || !Number.isFinite(posicao?.longitude)) return;
  if (Number.isFinite(posicao.accuracy) && posicao.accuracy > PRECISAO_MAX_M) return;

  const ponto = {
    lat: posicao.latitude,
    lon: posicao.longitude,
    quando: Number.isFinite(posicao.time) ? posicao.time : agora,
  };

  if (!anterior) {
    anterior = ponto;
    return;
  }

  const km = distanciaKm(anterior, ponto);
  if (km * 1000 < DESLOCAMENTO_MIN_M) return;

  // Denominador com piso: dois pontos no mesmo segundo dariam velocidade
  // infinita e descartariam deslocamento verdadeiro.
  const horas = Math.max(1 / 3600, (ponto.quando - anterior.quando) / 3600000);
  if (km / horas > KMH_IMPOSSIVEL) {
    // O ponto é descartado, mas vira a nova referência: senão o próximo
    // deslocamento seria medido a partir de uma posição já abandonada.
    anterior = ponto;
    return;
  }

  acumulado += km;
  anterior = ponto;
  salvar(false);
}

async function salvar(forcar) {
  if (!gravar) return;
  const agora = Date.now();
  if (!forcar && agora - ultimoSalvoEm < SALVAR_CADA_MS) return;
  ultimoSalvoEm = agora;
  try {
    await gravar(acumulado);
  } catch {
    /* sem banco, o acumulado segue em memória */
  }
}

/** Só para os testes: volta ao estado de quem nunca rastreou. */
export function zerarParaTeste() {
  vigia = null;
  anterior = null;
  acumulado = 0;
  ultimoSalvoEm = 0;
  gravar = null;
}
