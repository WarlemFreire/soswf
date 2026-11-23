// motor.js — o motor de etapas. Puro: recebe roteiro + OS + config e devolve o
// que pode ser feito agora, o que falta e se a etapa fecha. Nenhuma tela decide
// regra; todas perguntam aqui. Assim a regra e testada uma vez e vale em todas.
//
// Forma da OS:
//   { id, tipo, criadaEm, cliente, valor, pagamento, retornoDe, causaRetorno,
//     etapas: { [etapaId]: { dados: { [campoId]: { v, ts, gps? } },
//                             status: "concluida" | "excecao",
//                             excecao?: { texto, fotoId, ts },
//                             falhas?: [..], concluidaEm } },
//     concluidaEm?, revisar? }

export const CONFIG_PADRAO = {
  nitrogenio: { minutos: 30, resolucaoPsi: 5 },
  vacuo: { alvo: 500, limite: 1000, minutos: 10 },
  tensaoTolPct: 10,
  deltaT: { min: 8, max: 14 },
  operacaoMinutos: 15,
  revisaoTaxa: 0.2,
  garantiaDias: 90,
  excecaoMinCaracteres: 15,
};

export const CAUSAS_RETORNO = [
  "Vazamento na porca/flange",
  "Dreno / pingando",
  "Elétrica",
  "Ruído / vibração",
  "Falta de gás (sem vazamento achado)",
  "Defeito de fábrica",
  "Uso do cliente",
  "Outro",
];

const FEITA = new Set(["concluida", "excecao"]);

export function etapaFeita(os, etapaId) {
  return FEITA.has(os.etapas?.[etapaId]?.status);
}

/** Etapas cujas dependencias ja fecharam e que ainda nao fecharam. */
export function disponiveis(roteiro, os) {
  return roteiro.etapas.filter(
    (e) => !etapaFeita(os, e.id) && (e.depende || []).every((d) => etapaFeita(os, d))
  );
}

export function situacao(roteiro, os, etapaId) {
  const st = os.etapas?.[etapaId]?.status;
  if (st) return st;
  return disponiveis(roteiro, os).some((e) => e.id === etapaId) ? "disponivel" : "bloqueada";
}

/** Resolve um numero que pode vir da config: 30 ou (cfg) => cfg.nitrogenio.minutos. */
function resolver(v, config) {
  return typeof v === "function" ? v(config) : v;
}

/**
 * Um campo com `liberaApos` so pode ser preenchido N minutos depois de outro.
 * E isso que impede o teste de 30 min de virar teste de 5 min: o relogio e do
 * app (hora da foto), nao a palavra do tecnico.
 */
export function liberacaoCampo(campo, dados, config, agora) {
  if (!campo.liberaApos) return { liberado: true, faltamMs: 0 };
  const ref = dados?.[campo.liberaApos.campo];
  if (!ref?.ts) return { liberado: false, faltamMs: null, aguardando: campo.liberaApos.campo };
  const alvo = ref.ts + resolver(campo.liberaApos.minutos, config) * 60000;
  return { liberado: agora >= alvo, faltamMs: Math.max(0, alvo - agora), liberaEm: alvo };
}

function vazio(valor) {
  if (valor == null) return true;
  const v = valor.v;
  return v == null || v === "" || v === false;
}

export function camposFaltando(etapa, dados) {
  return etapa.campos.filter((c) => c.obrigatorio !== false && vazio(dados?.[c.id]));
}

/** Falhas da etapa: campos faltando + regras tecnicas do roteiro. */
export function avaliarEtapa(etapa, os, config, agora = Date.now()) {
  const dados = os.etapas?.[etapa.id]?.dados || {};
  const faltando = camposFaltando(etapa, dados);
  // Campo preenchido antes da hora (nao deveria acontecer pela tela, mas a
  // regra nao confia na tela).
  const adiantados = etapa.campos.filter((c) => {
    if (!c.liberaApos || vazio(dados[c.id])) return false;
    const ref = dados[c.liberaApos.campo];
    if (!ref?.ts) return true;
    return dados[c.id].ts < ref.ts + resolver(c.liberaApos.minutos, config) * 60000;
  });
  const regras =
    faltando.length === 0 && etapa.avaliar ? etapa.avaliar(valores(dados), os, config, dados) : [];
  return {
    faltando: faltando.map((c) => c.rotulo),
    falhasTecnicas: [
      ...adiantados.map((c) => `"${c.rotulo}" registrado antes do tempo mínimo`),
      ...regras,
    ],
  };
}

/** { campoId: valor cru } — o que as regras do roteiro enxergam. */
export function valores(dados) {
  const out = {};
  for (const [k, d] of Object.entries(dados || {})) out[k] = d?.v;
  return out;
}

export function registrarCampo(os, etapaId, campoId, v, extra = {}, agora = Date.now()) {
  const etapas = { ...os.etapas };
  const atual = etapas[etapaId] || { dados: {} };
  if (FEITA.has(atual.status)) throw new Error("Etapa já fechada. Reabra para alterar.");
  etapas[etapaId] = { ...atual, dados: { ...atual.dados, [campoId]: { v, ts: agora, ...extra } } };
  return { ...os, etapas };
}

/**
 * Fecha a etapa. Sem falha: "concluida". Com falha tecnica: so fecha com
 * excecao justificada (texto + foto) e vira "excecao", que manda a OS para
 * revisao. Campo obrigatorio faltando nunca fecha — excecao nao substitui
 * registro, so justifica um valor fora da faixa.
 */
export function concluirEtapa(roteiro, os, etapaId, config, { excecao, agora = Date.now() } = {}) {
  const etapa = roteiro.etapas.find((e) => e.id === etapaId);
  if (!etapa) throw new Error(`Etapa desconhecida: ${etapaId}`);
  if (situacao(roteiro, os, etapaId) !== "disponivel") {
    throw new Error("Etapa não está disponível (dependências abertas ou já fechada).");
  }
  const { faltando, falhasTecnicas } = avaliarEtapa(etapa, os, config, agora);
  if (faltando.length) {
    const erro = new Error(`Falta registrar: ${faltando.join(", ")}`);
    erro.faltando = faltando;
    throw erro;
  }
  const atual = os.etapas?.[etapaId] || { dados: {} };
  let fechada;
  if (falhasTecnicas.length === 0) {
    fechada = { ...atual, status: "concluida", falhas: [], concluidaEm: agora };
  } else {
    const minimo = config.excecaoMinCaracteres;
    if (!excecao || (excecao.texto || "").trim().length < minimo || !excecao.fotoId) {
      const erro = new Error(falhasTecnicas.join(" · "));
      erro.falhasTecnicas = falhasTecnicas;
      erro.exigeExcecao = true;
      throw erro;
    }
    fechada = {
      ...atual,
      status: "excecao",
      falhas: falhasTecnicas,
      excecao: { texto: excecao.texto.trim(), fotoId: excecao.fotoId, ts: agora },
      concluidaEm: agora,
    };
  }
  return { ...os, etapas: { ...os.etapas, [etapaId]: fechada } };
}

/** Todas as etapas que dependem (direta ou indiretamente) de etapaId. */
export function dependentes(roteiro, etapaId) {
  const out = new Set();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of roteiro.etapas) {
      if (out.has(e.id)) continue;
      if ((e.depende || []).some((d) => d === etapaId || out.has(d))) {
        out.add(e.id);
        mudou = true;
      }
    }
  }
  return out;
}

/**
 * Reabre uma etapa para correcao. Tudo que veio depois dela reabre junto: se o
 * vacuo foi refeito, a liberacao de gas e os testes posteriores nao valem mais.
 * Os dados ficam (nao se perde foto), so o fechamento cai.
 */
export function reabrirEtapa(roteiro, os, etapaId) {
  const alvo = new Set([etapaId, ...dependentes(roteiro, etapaId)]);
  const etapas = {};
  for (const [id, est] of Object.entries(os.etapas || {})) {
    if (alvo.has(id) && est.status) {
      const { status, concluidaEm, falhas, excecao, ...resto } = est;
      etapas[id] = { ...resto, reaberta: (est.reaberta || 0) + 1 };
    } else etapas[id] = est;
  }
  return { ...os, etapas, concluidaEm: undefined };
}

export function progresso(roteiro, os) {
  const total = roteiro.etapas.length;
  const feitas = roteiro.etapas.filter((e) => etapaFeita(os, e.id)).length;
  const excecoes = roteiro.etapas.filter((e) => os.etapas?.[e.id]?.status === "excecao").length;
  return { total, feitas, excecoes, completa: feitas === total };
}

/**
 * Fecha a OS. Revisao: toda OS com excecao + sorteio de `revisaoTaxa`. O
 * sorteio entra como parametro para o teste ser deterministico.
 */
export function finalizarOS(roteiro, os, config, { sorteio = Math.random(), agora = Date.now() } = {}) {
  const p = progresso(roteiro, os);
  if (!p.completa) throw new Error(`Faltam ${p.total - p.feitas} etapa(s).`);
  const motivo = p.excecoes > 0 ? "excecao" : sorteio < config.revisaoTaxa ? "sorteio" : null;
  return { ...os, concluidaEm: agora, revisar: motivo ? { motivo, feita: false } : null };
}

/** Uma OS so pode ser origem de retorno dentro da garantia. */
export function dentroDaGarantia(osOrigem, config, agora = Date.now()) {
  if (!osOrigem?.concluidaEm) return false;
  return agora - osOrigem.concluidaEm <= config.garantiaDias * 86400000;
}

/** Taxa de retorno por causa, so sobre OS cuja garantia ja venceu (senao a taxa e otimista). */
export function taxaRetorno(lista, config, agora = Date.now()) {
  const prazo = config.garantiaDias * 86400000;
  const maduras = lista.filter((o) => !o.retornoDe && o.concluidaEm && agora - o.concluidaEm > prazo);
  const ids = new Set(maduras.map((o) => o.id));
  const retornos = lista.filter((o) => o.retornoDe && ids.has(o.retornoDe));
  const comRetorno = new Set(retornos.map((r) => r.retornoDe));
  const porCausa = {};
  for (const r of retornos) porCausa[r.causaRetorno || "Sem causa"] = (porCausa[r.causaRetorno || "Sem causa"] || 0) + 1;
  return {
    base: maduras.length,
    comRetorno: comRetorno.size,
    taxa: maduras.length ? comRetorno.size / maduras.length : null,
    porCausa,
  };
}
