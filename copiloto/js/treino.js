// treino.js — alimenta o modelo com a experiência real, uma vez cada.
//
// O modelo (modelo.js) é a matemática; este arquivo é a ligação dele com o que
// de fato aconteceu na rua. A regra que mais importa aqui:
//
//   CADA TRECHO TREINA UMA VEZ, PARA SEMPRE.
//
// Treinar duas vezes a mesma noite faria o modelo acreditar nela com o dobro da
// força, e abrir o aplicativo seria uma forma de distorcer o que ele aprendeu.
// Por isso o marcador `ate`: só entra trecho que começou depois do último já
// treinado.
//
// O treino roda em segundo plano, quando o app abre e quando uma jornada fecha.
// É aritmética de alguns milissegundos sobre dado que já está em memória --
// nada de rede, nada de espera.

import { db } from "./db.js";
import * as Mod from "./modelo.js";
import * as F from "./faixas.js";
import * as E from "./estrategia.js";
import * as M from "./metrics.js";

const CHAVE = "principal";

/** Trecho curto demais não descreve ritmo: é um registro batido logo após o outro. */
const MS_MINIMO = 5 * 60 * 1000;

/** R$/h impossível é erro de lançamento, não aprendizado. */
const RH_MAXIMO = 400;

export async function carregar() {
  const linha = await db.get("modelo", CHAVE);
  return {
    modelo: Mod.desserializar(linha?.dados),
    ate: linha?.ate ?? 0,
  };
}

export async function guardar(modelo, ate) {
  await db.put("modelo", { chave: CHAVE, dados: Mod.serializar(modelo), ate, em: Date.now() });
}

/**
 * Transforma trechos em observações.
 *
 * PURA de propósito: é onde se decide o que vira exemplo de aprendizado, e isso
 * precisa ser verificável sem banco.
 */
export function observacoesDe(trechos, pontos, { ate = 0 } = {}) {
  return (trechos || [])
    .filter((t) => t.inicio > ate)
    .filter((t) => t.ms >= MS_MINIMO && t.valor > 0)
    .map((t) => ({
      quando: t.inicio,
      regiao: E.regiaoDoTrecho(t, pontos),
      reaisPorHora: t.valor / (t.ms / M.HORA),
    }))
    // Sem região não há o que ensinar sobre lugar, mas o horário ainda ensina.
    .filter((o) => Number.isFinite(o.reaisPorHora) && o.reaisPorHora > 0 && o.reaisPorHora < RH_MAXIMO)
    .sort((a, b) => a.quando - b.quando);
}

/**
 * Treina o que ainda não foi treinado e guarda.
 *
 * Devolve quantas observações entraram -- zero é resposta normal e boa: quer
 * dizer que não houve jornada nova desde a última vez.
 */
export async function atualizar({ jornadas, registros, trilha } = {}) {
  const { modelo, ate } = await carregar();

  const trechos = F.trechosDe(jornadas || [], registros || []);
  const pontos = (trilha || [])
    .filter((p) => Number.isFinite(p?.quando))
    .sort((a, b) => a.quando - b.quando);

  const novas = observacoesDe(trechos, pontos, { ate });
  if (!novas.length) return { treinadas: 0, modelo };

  for (const o of novas) {
    Mod.treinar(modelo, { quando: o.quando, regiao: o.regiao }, o.reaisPorHora);
  }

  await guardar(modelo, novas[novas.length - 1].quando);
  return { treinadas: novas.length, modelo };
}

/** Recomeça do zero. Usado quando ele apaga os dados. */
export async function esquecer() {
  await db.remover("modelo", CHAVE);
}

/**
 * O que o modelo acha agora, para a tela.
 *
 * Devolve null quando ele ainda não tem base: a tela mostra "aprendendo" em vez
 * de uma recomendação com cara de certeza saída de cinco observações.
 */
export function recomendacao(modelo, agora = Date.now()) {
  const d = Mod.desempenho(modelo);
  if (!d.pronto || !d.melhorQueAMedia || !modelo.regioes.length) return null;

  const opcoes = modelo.regioes.map((regiao) => ({ quando: agora, regiao }));
  const [melhor] = Mod.escolher(modelo, opcoes);
  if (!melhor) return null;

  return {
    regiao: `região ${modelo.regioes.indexOf(melhor.regiao) + 1}`,
    celula: melhor.regiao,
    reaisPorHora: Math.round(melhor.reaisPorHora),
    confianca: melhor.confianca,
    explorando: melhor.explorando,
    observacoes: modelo.n,
    ganhoPct: d.ganhoPct,
  };
}
