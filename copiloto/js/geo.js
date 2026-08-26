// geo.js — posição pontual e wake lock.
//
// Aqui havia um rastreador contínuo que acumulava quilometragem por GPS. Foi
// removido depois da primeira noite de uso real, em que mediu menos da metade
// da distância verdadeira. A causa não tem conserto no navegador: o motorista
// passa a jornada com o app da plataforma em primeiro plano, e o Android
// suspende o watchPosition de uma aba que não está visível. Não existe
// geolocalização em segundo plano na web, e service worker não acessa
// geolocation — só app nativo resolveria.
//
// O que sobrou funciona porque não depende de continuidade: uma leitura
// pontual no instante do registro, quando o app está aberto na frente dele.

const RAIO_TERRA_KM = 6371;

/** Distância entre duas coordenadas, para a análise por zona. */
export function distanciaKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PRECISAO_MAX_M = 200;

/**
 * Uma leitura de posição, agora. Nunca rejeita: sem permissão, sem sinal ou
 * fora do prazo devolve null, e o registro segue sem coordenada.
 */
export function posicaoAgora({ prazoMs = 8000 } = {}) {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (valor) => {
      if (respondido) return;
      respondido = true;
      resolve(valor);
    };
    setTimeout(() => responder(null), prazoMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.accuracy > PRECISAO_MAX_M) return responder(null);
        responder({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisao: pos.coords.accuracy,
          quando: pos.timestamp || Date.now(),
        });
      },
      () => responder(null),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: prazoMs }
    );
  });
}

/* -------------------------------------------------------------- wake lock */

let sentinela = null;

export async function manterTelaLigada() {
  if (!("wakeLock" in navigator)) return false;
  try {
    sentinela = await navigator.wakeLock.request("screen");
    sentinela.addEventListener("release", () => {
      sentinela = null;
    });
    return true;
  } catch {
    return false;
  }
}

export async function liberarTela() {
  try {
    await sentinela?.release();
  } catch {
    /* ja liberado */
  }
  sentinela = null;
}

export function telaEstaTravada() {
  return sentinela != null;
}

/** O wake lock cai quando o app vai para segundo plano; ao voltar, repede. */
export function religarAoVoltar(deveEstarLigado) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && deveEstarLigado() && !telaEstaTravada()) {
      manterTelaLigada();
    }
  });
}
