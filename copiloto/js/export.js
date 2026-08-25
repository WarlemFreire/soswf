// export.js — backup e restauracao. Nenhum dado sai do aparelho sozinho; o
// unico caminho de saida é este, e é o motorista quem aperta.

import { db, NOMES_STORES } from "./db.js";
import { configAtual, aplicarConfig } from "./config.js";
import * as M from "./metrics.js";

const VERSAO_BACKUP = 1;

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function exportarJson() {
  const dados = await db.despejarTudo();
  const pacote = {
    app: "copiloto",
    versao: VERSAO_BACKUP,
    exportadoEm: new Date().toISOString(),
    config: configAtual(),
    dados,
  };
  baixar(`copiloto-backup-${carimbo()}.json`, JSON.stringify(pacote, null, 2), "application/json");
  return pacote;
}

function csv(linhas) {
  const escapar = (v) => {
    if (v == null) return "";
    const texto = String(v);
    return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  // Ponto e virgula + BOM para o Excel brasileiro abrir sem bagunçar colunas.
  return "﻿" + linhas.map((linha) => linha.map(escapar).join(";")).join("\n");
}

const numeroBr = (v, casas = 2) => (v == null ? "" : v.toFixed(casas).replace(".", ","));

export async function exportarCsvJornadas() {
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const pausas = await db.todos("pausas");
  const config = configAtual();

  const linhas = [
    [
      "data", "inicio", "fim", "odometro_inicio", "odometro_fim", "km",
      "tempo_rua_h", "tempo_ativo_h", "tempo_pausa_h",
      "bruto", "uber", "99", "indrive", "avulso",
      "reais_por_hora", "reais_por_km", "custo_estimado", "liquido_estimado",
      "meta_minima", "meta_ideal", "meta_otima", "observacoes",
    ],
  ];

  for (const j of jornadas.sort((a, b) => a.horaInicio - b.horaInicio)) {
    const rs = M.registrosValidos(registros.filter((r) => r.jornadaId === j.id));
    const ps = pausas.filter((p) => p.jornadaId === j.id);
    const fim = j.horaFim ?? Date.now();
    const saldo = M.saldoTotal(rs);
    const km = M.kmPercorrido(j, rs, j.gpsFim ?? null);
    const ativo = M.msAtivo(j, ps, fim);
    const fontes = M.saldoPorFonte(rs);
    const custos = M.custosEstimados(km, config);

    linhas.push([
      j.data,
      new Date(j.horaInicio).toISOString(),
      j.horaFim ? new Date(j.horaFim).toISOString() : "",
      j.odometroInicio ?? "",
      j.odometroFim ?? "",
      numeroBr(km, 1),
      numeroBr(M.msRua(j, fim) / M.HORA),
      numeroBr(ativo / M.HORA),
      numeroBr(M.msPausado(ps, fim) / M.HORA),
      numeroBr(saldo),
      numeroBr(fontes.uber.valor),
      numeroBr(fontes["99"].valor),
      numeroBr(fontes.indrive.valor),
      numeroBr(fontes.avulso.valor),
      numeroBr(M.reaisPorHora(saldo, ativo)),
      numeroBr(M.reaisPorKm(saldo, km)),
      numeroBr(custos.total),
      numeroBr(saldo - custos.total),
      j.metaMinima ?? "",
      j.metaIdeal ?? "",
      j.metaOtima ?? "",
      j.observacoes ?? "",
    ]);
  }

  baixar(`copiloto-jornadas-${carimbo()}.csv`, csv(linhas), "text/csv");
  return linhas.length - 1;
}

export async function exportarCsvRegistros() {
  const jornadas = await db.todos("jornadas");
  const registros = await db.todos("registros");
  const porId = new Map(jornadas.map((j) => [j.id, j]));

  const linhas = [
    [
      "data", "hora", "jornada_id", "tipo", "uber", "99", "indrive",
      "avulso_valor", "avulso_tipo", "odometro", "km_gps", "lat", "lon", "desfeito",
    ],
  ];

  for (const r of registros.sort((a, b) => a.timestamp - b.timestamp)) {
    const j = porId.get(r.jornadaId);
    linhas.push([
      j?.data ?? M.chaveData(r.timestamp),
      new Date(r.timestamp).toISOString(),
      r.jornadaId,
      r.tipo || "checkpoint",
      numeroBr(r.saldos?.uber),
      numeroBr(r.saldos?.["99"]),
      numeroBr(r.saldos?.indrive),
      numeroBr(r.avulso?.valor),
      r.avulso?.tipo ?? "",
      r.odometro ?? "",
      numeroBr(r.gpsAcum, 3),
      r.posicao?.lat ?? "",
      r.posicao?.lon ?? "",
      r.desfeito ? "sim" : "nao",
    ]);
  }

  baixar(`copiloto-registros-${carimbo()}.csv`, csv(linhas), "text/csv");
  return linhas.length - 1;
}

export async function exportarCsvPausas() {
  const jornadas = await db.todos("jornadas");
  const pausas = await db.todos("pausas");
  const porId = new Map(jornadas.map((j) => [j.id, j]));

  const linhas = [["data", "inicio", "fim", "minutos", "motivo", "jornada_id"]];
  for (const p of pausas.sort((a, b) => a.horaInicio - b.horaInicio)) {
    linhas.push([
      porId.get(p.jornadaId)?.data ?? M.chaveData(p.horaInicio),
      new Date(p.horaInicio).toISOString(),
      p.horaFim ? new Date(p.horaFim).toISOString() : "",
      p.horaFim ? Math.round((p.horaFim - p.horaInicio) / M.MINUTO) : "",
      p.motivo,
      p.jornadaId,
    ]);
  }
  baixar(`copiloto-pausas-${carimbo()}.csv`, csv(linhas), "text/csv");
  return linhas.length - 1;
}

/**
 * Importa um backup. `modo` "mesclar" mantem o que ja existe e sobrescreve por
 * id; "substituir" limpa tudo antes. A escolha é do usuario, na tela.
 */
export async function importarJson(texto, { modo = "mesclar" } = {}) {
  let pacote;
  try {
    pacote = JSON.parse(texto);
  } catch {
    throw new Error("Arquivo não é um JSON válido.");
  }
  if (pacote.app !== "copiloto" || !pacote.dados) {
    throw new Error("Este arquivo não é um backup do Copiloto.");
  }

  const contagem = {};
  for (const store of NOMES_STORES) {
    const linhas = pacote.dados[store];
    if (!Array.isArray(linhas)) continue;
    if (modo === "substituir") await db.limpar(store);
    if (linhas.length) await db.putVarios(store, linhas);
    contagem[store] = linhas.length;
  }
  if (pacote.config) await aplicarConfig(pacote.config);
  return contagem;
}

export async function apagarTudo() {
  for (const store of NOMES_STORES) await db.limpar(store);
}
