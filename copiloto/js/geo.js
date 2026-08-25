// geo.js — acumulacao de quilometragem por GPS e wake lock da tela.
// Ambos sao opcionais: o app funciona inteiro sem eles.

const RAIO_TERRA_KM = 6371;

// Filtros para nao acumular ruido de GPS parado no semaforo nem teleporte de
// fix ruim. 12 m de piso e 250 km/h de teto cobrem bem o uso urbano.
const PRECISAO_MAX_M = 60;
const DISTANCIA_MIN_KM = 0.012;
const VELOCIDADE_MAX_KMH = 250;

export function distanciaKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decide se um novo fix deve somar ao acumulado.
 * Exportado separado do watcher para poder ser testado sem browser.
 */
export function aceitarFix(anterior, atual) {
  if (atual.precisao != null && atual.precisao > PRECISAO_MAX_M) {
    return { aceito: false, motivo: "impreciso", km: 0 };
  }
  if (!anterior) return { aceito: false, motivo: "primeiro", km: 0 };

  const km = distanciaKm(anterior, atual);
  if (km < DISTANCIA_MIN_KM) return { aceito: false, motivo: "parado", km: 0 };

  const horas = (atual.quando - anterior.quando) / 3600000;
  if (horas > 0 && km / horas > VELOCIDADE_MAX_KMH) {
    return { aceito: false, motivo: "salto", km: 0 };
  }
  return { aceito: true, motivo: "ok", km };
}

export class RastreadorKm {
  constructor({ aoAtualizar } = {}) {
    this.acumulado = 0;
    this.ultimo = null;
    this.watchId = null;
    this.ativo = false;
    this.erro = null;
    this.aoAtualizar = aoAtualizar || (() => {});
  }

  get disponivel() {
    return typeof navigator !== "undefined" && "geolocation" in navigator;
  }

  iniciar(acumuladoInicial = 0) {
    if (!this.disponivel || this.watchId != null) return false;
    this.acumulado = acumuladoInicial;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.#receber(pos),
      (erro) => {
        this.erro = erro.message;
        this.ativo = false;
        this.aoAtualizar(this.acumulado, this);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    this.ativo = true;
    this.erro = null;
    return true;
  }

  #receber(pos) {
    const fix = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      precisao: pos.coords.accuracy,
      quando: pos.timestamp || Date.now(),
    };
    const resultado = aceitarFix(this.ultimo, fix);
    if (resultado.aceito) this.acumulado += resultado.km;
    // Guarda o fix mesmo quando rejeitado por distancia, senao um carro lento
    // nunca acumularia nada.
    if (resultado.motivo !== "impreciso" && resultado.motivo !== "salto") {
      this.ultimo = fix;
    }
    this.ativo = true;
    this.erro = null;
    if (resultado.aceito) this.aoAtualizar(this.acumulado, this);
  }

  parar() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.ativo = false;
    this.ultimo = null;
    return this.acumulado;
  }

  /** Coordenada mais recente, para enriquecer o registro quando existir. */
  posicaoAtual() {
    if (!this.ultimo) return null;
    return { lat: this.ultimo.lat, lon: this.ultimo.lon };
  }
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

/**
 * O wake lock cai sozinho quando o app vai para segundo plano. Voltando ao
 * primeiro plano com jornada ativa, precisa ser pedido de novo.
 */
export function religarAoVoltar(deveEstarLigado) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && deveEstarLigado() && !telaEstaTravada()) {
      manterTelaLigada();
    }
  });
}
