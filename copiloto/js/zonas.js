// zonas.js — áreas de risco demarcadas por coordenada. Puro e testável.
//
// POR QUE COORDENADA E NÃO NOME. A plataforma renomeia bairro, troca "Centro"
// por "Centro Histórico", escreve a rua em vez do bairro. Uma lista de nomes
// envelhece sozinha e para de casar sem ninguém perceber -- que é o pior tipo
// de falha, porque o aviso simplesmente deixa de vir. Uma coordenada não muda.
//
// O QUE A COORDENADA RESPONDE, E O QUE NÃO RESPONDE. Isto precisa estar claro
// no código porque é a limitação que define o recurso:
//
//   RESPONDE  "eu estou dentro de uma área marcada" e "estou a X metros de
//             entrar numa". No instante da oferta o GPS sabe onde ele está, e
//             o embarque de uma corrida de aplicativo é quase sempre perto.
//
//   NÃO RESPONDE  "esta corrida TERMINA numa área marcada". O destino só existe
//             na tela como texto; não há coordenada dele. Traduzir texto em
//             coordenada exigiria consultar um serviço de geocodificação, que
//             é rede e é mandar o endereço dele para fora -- as duas coisas que
//             este app não faz.
//
// Por isso a lista de nomes continua existindo ao lado: ela é a única que
// alcança o destino. As duas juntas cobrem mais do que qualquer uma sozinha.

import { normalizar, termoValido } from "./risco.js";

const RAIO_TERRA_KM = 6371;

/** Abaixo disto o GPS urbano não distingue, e a zona viraria alarme aleatório. */
export const RAIO_MINIMO_M = 100;
export const RAIO_MAXIMO_M = 5000;

/** Distância em que o aviso de aproximação dispara. */
export const APROXIMACAO_M = 400;

export const TIPOS = [
  { id: "circulo", nome: "Círculo" },
  { id: "poligono", nome: "Contorno" },
];

/* --------------------------------------------------------------- geometria */

/** Haversine, em metros. */
export function metrosEntre(a, b) {
  if (!coordenadaValida(a) || !coordenadaValida(b)) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * 1000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function coordenadaValida(p) {
  return (
    Number.isFinite(p?.lat) && Number.isFinite(p?.lon) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
  );
}

/**
 * Ponto dentro do polígono, por lançamento de raio.
 *
 * Em escala de bairro a curvatura da Terra não muda o resultado, então lat/lon
 * são tratados como plano. Para uma zona de cinco quilômetros o erro é menor
 * que a precisão do próprio GPS.
 */
export function dentroDoPoligono(ponto, pontos) {
  if (!coordenadaValida(ponto) || !Array.isArray(pontos) || pontos.length < 3) return false;

  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i];
    const b = pontos[j];
    if (!coordenadaValida(a) || !coordenadaValida(b)) continue;

    const cruza = a.lat > ponto.lat !== b.lat > ponto.lat;
    if (!cruza) continue;

    const corte = ((b.lon - a.lon) * (ponto.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (ponto.lon < corte) dentro = !dentro;
  }
  return dentro;
}

/**
 * A que distância da zona o ponto está.
 *
 * Negativo quer dizer dentro. Para polígono devolve 0 quando dentro, e a menor
 * distância até um vértice quando fora -- aproximação que basta para o aviso de
 * aproximação e não exige projeção em segmento.
 */
export function distanciaAteZona(ponto, zona) {
  if (!coordenadaValida(ponto) || !zona) return null;

  if (zona.tipo === "poligono") {
    if (dentroDoPoligono(ponto, zona.pontos)) return -1;
    const distancias = (zona.pontos || [])
      .map((p) => metrosEntre(ponto, p))
      .filter((d) => d != null);
    return distancias.length ? Math.min(...distancias) : null;
  }

  const centro = zona.centro;
  const d = metrosEntre(ponto, centro);
  if (d == null) return null;
  return d - (Number(zona.raio) || 0);
}

/* ------------------------------------------------------------- avaliação */

/**
 * Como o ponto se relaciona com as zonas.
 *
 * Devolve sempre a MAIS GRAVE e MAIS PRÓXIMA: dentro ganha de perto, e
 * "não pegar" ganha de "atenção". Só uma cabe no selo.
 */
export function avaliar(ponto, zonas, { aproximacao = APROXIMACAO_M } = {}) {
  if (!coordenadaValida(ponto)) return null;

  let melhor = null;
  for (const zona of zonas || []) {
    if (zona?.ativa === false) continue;
    const d = distanciaAteZona(ponto, zona);
    if (d == null || d > aproximacao) continue;

    const candidato = {
      id: zona.id,
      nome: zona.nome,
      nivel: zona.nivel === "evitar" ? "evitar" : "atencao",
      dentro: d <= 0,
      metros: Math.max(0, Math.round(d)),
    };
    if (!melhor || melhorQue(candidato, melhor)) melhor = candidato;
  }
  return melhor;
}

function melhorQue(a, b) {
  // Dentro sempre ganha de perto.
  if (a.dentro !== b.dentro) return a.dentro;
  // Depois a gravidade.
  const grave = (x) => (x.nivel === "evitar" ? 1 : 0);
  if (grave(a) !== grave(b)) return grave(a) > grave(b);
  // Empatado, a mais próxima.
  return a.metros < b.metros;
}

/* --------------------------------------------------------------- guardar */

export function normalizarZona(zona) {
  const tipo = zona?.tipo === "poligono" ? "poligono" : "circulo";
  const base = {
    id: zona?.id || `zona-${Date.now().toString(36)}`,
    nome: String(zona?.nome || "").trim() || "Sem nome",
    nivel: zona?.nivel === "evitar" ? "evitar" : "atencao",
    ativa: zona?.ativa !== false,
    tipo,
    // Nomes que a plataforma usa para este lugar. Complemento, não substituto:
    // é o único caminho que alcança o DESTINO da corrida.
    termos: [...new Set((zona?.termos || []).map((t) => String(t).trim()).filter(Boolean))],
  };

  if (tipo === "poligono") {
    const pontos = (zona?.pontos || []).filter(coordenadaValida);
    // Menos de três pontos não fecha área. Cai para círculo em vez de virar uma
    // zona que existe e nunca dispara.
    if (pontos.length < 3) {
      return { ...base, tipo: "circulo", centro: pontos[0] || null, raio: RAIO_MINIMO_M };
    }
    return { ...base, pontos };
  }

  return {
    ...base,
    centro: coordenadaValida(zona?.centro) ? { lat: zona.centro.lat, lon: zona.centro.lon } : null,
    raio: Math.min(RAIO_MAXIMO_M, Math.max(RAIO_MINIMO_M, Number(zona?.raio) || RAIO_MINIMO_M)),
  };
}

/** A zona tem desenho no mapa? */
export function temGeometria(zona) {
  if (zona?.tipo === "poligono") return (zona.pontos || []).filter(coordenadaValida).length >= 3;
  return coordenadaValida(zona?.centro) && Number(zona?.raio) >= RAIO_MINIMO_M;
}

/**
 * Uma zona serve para alguma coisa?
 *
 * Desenho OU nome. Só desenho alcança o início da corrida; só nome alcança o
 * destino. Exigir os dois descartaria zona que ainda é útil pela metade.
 */
export function zonaUtil(zona) {
  if (zona?.ativa === false) return false;
  return temGeometria(zona) || (zona?.termos || []).some(termoValido);
}

/**
 * O que vai para o serviço de acessibilidade.
 *
 * Os termos vão JÁ NORMALIZADOS. Se o Java normalizasse por conta própria
 * existiriam duas normalizações que divergem na primeira correção, e a zona
 * pararia de casar sem ninguém entender por quê.
 */
export function paraOServico(zonas) {
  return (zonas || []).filter(zonaUtil).map((z) => {
    const comum = {
      nome: z.nome,
      nivel: z.nivel,
      termos: (z.termos || []).filter(termoValido).map(normalizar),
    };
    if (!temGeometria(z)) return { ...comum, tipo: "nome" };
    return z.tipo === "poligono"
      ? { ...comum, tipo: "poligono", pontos: z.pontos }
      : { ...comum, tipo: "circulo", lat: z.centro.lat, lon: z.centro.lon, raio: z.raio };
  });
}

/* ------------------------------------------------------------ desenho */

/**
 * Caixa que contém tudo o que vai ser desenhado, com folga.
 *
 * Existe porque o editor não tem mapa de verdade: sem telha de servidor (que
 * seria rede, e mandaria a posição dele para fora), o fundo é o próprio rastro
 * dele. A caixa é o que transforma coordenada em pixel.
 */
export function caixaDe(pontos, { folga = 0.15 } = {}) {
  const validos = (pontos || []).filter(coordenadaValida);
  if (!validos.length) return null;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of validos) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }

  // Um ponto só não tem extensão: abre uma janela mínima em volta dele.
  const alturaMin = 0.004;
  if (maxLat - minLat < alturaMin) {
    const meio = (maxLat + minLat) / 2;
    minLat = meio - alturaMin / 2;
    maxLat = meio + alturaMin / 2;
  }
  if (maxLon - minLon < alturaMin) {
    const meio = (maxLon + minLon) / 2;
    minLon = meio - alturaMin / 2;
    maxLon = meio + alturaMin / 2;
  }

  const dLat = (maxLat - minLat) * folga;
  const dLon = (maxLon - minLon) * folga;
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLon: minLon - dLon, maxLon: maxLon + dLon };
}

/** Converte coordenada em pixel dentro de uma caixa de largura×altura. */
export function paraTela(ponto, caixa, largura, altura) {
  if (!caixa || !coordenadaValida(ponto)) return null;
  const x = ((ponto.lon - caixa.minLon) / (caixa.maxLon - caixa.minLon)) * largura;
  // Latitude cresce para o norte, y cresce para baixo.
  const y = altura - ((ponto.lat - caixa.minLat) / (caixa.maxLat - caixa.minLat)) * altura;
  return { x, y };
}

/** O inverso, para o toque no desenho virar coordenada. */
export function daTela(x, y, caixa, largura, altura) {
  if (!caixa) return null;
  return {
    lon: caixa.minLon + (x / largura) * (caixa.maxLon - caixa.minLon),
    lat: caixa.minLat + ((altura - y) / altura) * (caixa.maxLat - caixa.minLat),
  };
}
