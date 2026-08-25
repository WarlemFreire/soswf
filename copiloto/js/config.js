// config.js — configuracoes do app, com os defaults calibrados para a operacao
// real do motorista (10h / 200km / R$350 brutos por dia, GNV a R$4,30/m3).

import { db } from "./db.js";

export const PLATAFORMAS = [
  { id: "uber", nome: "Uber", cor: "#8ab4ff" },
  { id: "99", nome: "99", cor: "#ffd93d" },
  { id: "indrive", nome: "inDrive", cor: "#5ce68a" },
];

export const TIPOS_AVULSO = [
  { id: "particular", nome: "Particular" },
  { id: "frete", nome: "Frete" },
  { id: "entrega", nome: "Entrega" },
  { id: "outro", nome: "Outro" },
];

export const MOTIVOS_PAUSA = [
  { id: "almoco", nome: "Almoço", icone: "🍽️" },
  { id: "abastecimento", nome: "Abastecer", icone: "⛽" },
  { id: "descanso", nome: "Descanso", icone: "🛋️" },
  { id: "cochilo", nome: "Cochilo", icone: "😴" },
  { id: "banheiro", nome: "Banheiro", icone: "🚻" },
  { id: "pessoal", nome: "Pessoal", icone: "📱" },
  { id: "espera_estrategica", nome: "Espera", icone: "📍" },
  { id: "outro", nome: "Outro", icone: "⋯" },
];

// Faixas de R$/km da JORNADA (contando km vazio), nao da corrida ofertada.
// Ancoradas na mediana real de R$1,75/km — as faixas genericas de mercado
// (1,80 a 7,00) sao de corrida ofertada e deixariam o semaforo vermelho o dia
// inteiro se aplicadas aqui.
export const PERIODOS = [
  { id: "manha", nome: "Manhã", inicio: 6, fim: 12 },
  { id: "tarde", nome: "Tarde", inicio: 12, fim: 18 },
  { id: "noite", nome: "Noite", inicio: 18, fim: 22 },
  { id: "pico", nome: "Pico", inicio: 22, fim: 2 },
  { id: "madrugada", nome: "Madrugada", inicio: 2, fim: 6 },
];

export const CONFIG_PADRAO = {
  plataformaPrincipal: "uber",
  plataformasAtivas: ["uber", "99", "indrive"],

  metaMinima: 280,
  metaIdeal: 350,
  metaOtima: 450,
  horaLimiteMeta: 23,

  faixasKm: {
    manha: { piso: 1.45, ideal: 1.7, otimo: 2.0 },
    tarde: { piso: 1.55, ideal: 1.8, otimo: 2.15 },
    noite: { piso: 1.7, ideal: 2.0, otimo: 2.4 },
    pico: { piso: 1.9, ideal: 2.3, otimo: 2.8 },
    madrugada: { piso: 1.7, ideal: 2.0, otimo: 2.4 },
  },
  faixaHora: { piso: 32, ideal: 40, otimo: 50 },

  // Energia: 95% GNV / 5% etanol. A Fase 2 substitui estes valores pelo
  // consumo real medido entre dois abastecimentos.
  mixGnvPct: 95,
  precoGnv: 4.3,
  kmPorM3: 10,
  precoEtanol: 4.0,
  kmPorLitro: 7,
  custoDesgasteKm: 0.25,

  usarGps: true,
  manterTelaLigada: true,
  vibrar: true,
  tts: false,
  tema: "auto",
  horaModoNoturno: 18,
  modoDirigindo: false,
  alertaPausaMin: 45,
};

let cache = { ...CONFIG_PADRAO };

export function cfg(chave) {
  return cache[chave];
}

export function configAtual() {
  return { ...cache };
}

export async function carregarConfig() {
  const linhas = await db.todos("config");
  for (const linha of linhas) {
    if (linha.chave in CONFIG_PADRAO) cache[linha.chave] = linha.valor;
  }
  return configAtual();
}

export async function salvarConfig(chave, valor) {
  cache[chave] = valor;
  await db.put("config", { chave, valor });
  return valor;
}

export async function restaurarPadroes() {
  cache = { ...CONFIG_PADRAO };
  await db.limpar("config");
  return configAtual();
}

/** Aplica um objeto inteiro de configuracoes (usado na importacao de backup). */
export async function aplicarConfig(objeto) {
  for (const [chave, valor] of Object.entries(objeto || {})) {
    if (chave in CONFIG_PADRAO) await salvarConfig(chave, valor);
  }
  return configAtual();
}

/** R$/km só de energia (combustivel). */
export function custoEnergiaKm(c = cache) {
  const fatiaGnv = Math.min(100, Math.max(0, c.mixGnvPct)) / 100;
  const porKmGnv = c.kmPorM3 > 0 ? c.precoGnv / c.kmPorM3 : 0;
  const porKmEtanol = c.kmPorLitro > 0 ? c.precoEtanol / c.kmPorLitro : 0;
  return fatiaGnv * porKmGnv + (1 - fatiaGnv) * porKmEtanol;
}

/** R$/km total: energia + desgaste. É o break-even mostrado no medidor. */
export function custoTotalKm(c = cache) {
  return custoEnergiaKm(c) + (c.custoDesgasteKm || 0);
}
