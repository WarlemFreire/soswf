// calculos.js — as contas que decidem se uma etapa passa. Funcoes puras, sem
// DOM, para poderem ser testadas em Node: e aqui que um erro vira retorno.

export const ATM_PSI = 14.696;
const KELVIN = 273.15;

/** Numero valido (aceita "12,5" digitado com virgula). */
export function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Teste de estanqueidade com nitrogenio, compensado pela temperatura.
 *
 * O gas no tubo segue P/T constante (lei dos gases, volume fixo). As contas tem
 * que ser em pressao ABSOLUTA e temperatura em KELVIN: fazer em manometrica e
 * Celsius erra feio (de 20 °C para 10 °C nao e "metade da pressao").
 *
 *   P_esperada_abs = P_ini_abs × (T_fim + 273,15) / (T_ini + 273,15)
 *   queda = P_esperada − P_fim   (de volta em manometrica)
 *
 * Reprova se a queda corrigida passar de uma divisao do manometro.
 */
export function testeNitrogenio({ pIni, pFim, tIni, tFim, minutos, resolucao, minutosMin }) {
  const vals = { pIni: num(pIni), pFim: num(pFim), tIni: num(tIni), tFim: num(tFim) };
  const falhas = [];
  for (const [k, v] of Object.entries(vals)) if (v == null) falhas.push(`Falta ${k}`);
  if (falhas.length) return { ok: false, falhas };

  const pEsperada =
    ((vals.pIni + ATM_PSI) * (vals.tFim + KELVIN)) / (vals.tIni + KELVIN) - ATM_PSI;
  const queda = pEsperada - vals.pFim;

  if (vals.pIni <= 0) falhas.push("Pressão inicial precisa ser positiva");
  if (minutos != null && minutos < minutosMin) {
    falhas.push(`Teste durou ${Math.floor(minutos)} min; mínimo ${minutosMin} min`);
  }
  if (queda > resolucao) {
    falhas.push(
      `Queda corrigida de ${queda.toFixed(1)} psi (esperado ${pEsperada.toFixed(1)}, ` +
        `medido ${vals.pFim}) passa de 1 divisão (${resolucao} psi): há vazamento`
    );
  }
  return { ok: falhas.length === 0, falhas, pEsperada, queda };
}

/**
 * Vacuo: precisa chegar ao alvo e, isolado da bomba, nao subir alem do limite
 * no tempo minimo. Subida grande = vazamento; subida que estabiliza acima do
 * limite = umidade ainda no sistema. Nos dois casos o vacuo nao terminou.
 */
export function testeVacuo({ micronAtingido, micronFinal, minutos, alvo, limite, minutosMin }) {
  const a = num(micronAtingido);
  const f = num(micronFinal);
  const falhas = [];
  if (a == null) falhas.push("Falta o mícron atingido");
  if (f == null) falhas.push("Falta o mícron após isolar");
  if (falhas.length) return { ok: false, falhas };
  if (a > alvo) falhas.push(`Vácuo atingido ${a} mícron; precisa ≤ ${alvo}`);
  if (f > limite) falhas.push(`Subiu para ${f} mícron isolado; limite ${limite} (vazamento ou umidade)`);
  if (minutos != null && minutos < minutosMin) {
    falhas.push(`Isolado por ${Math.floor(minutos)} min; mínimo ${minutosMin} min`);
  }
  return { ok: falhas.length === 0, falhas, subida: f - a };
}

/** Tensao dentro de ±tol% da nominal da etiqueta. */
export function checarTensao(medida, nominal, tolPct) {
  const m = num(medida);
  const n = num(nominal);
  if (m == null) return ["Falta a tensão medida"];
  if (n == null) return ["Falta a tensão nominal (etiqueta da vistoria)"];
  const min = n * (1 - tolPct / 100);
  const max = n * (1 + tolPct / 100);
  return m < min || m > max
    ? [`Tensão ${m} V fora de ${min.toFixed(0)}–${max.toFixed(0)} V (±${tolPct}% de ${n} V)`]
    : [];
}

/** Corrente nao pode passar da nominal da etiqueta. */
export function checarCorrente(medida, nominal) {
  const m = num(medida);
  const n = num(nominal);
  if (m == null) return ["Falta a corrente medida"];
  if (n == null) return ["Falta a corrente nominal (etiqueta da vistoria)"];
  return m > n ? [`Corrente ${m} A acima da nominal ${n} A`] : [];
}

/** ΔT = retorno − insuflamento, dentro da faixa. */
export function checarDeltaT(retorno, insuflamento, min, max) {
  const r = num(retorno);
  const i = num(insuflamento);
  if (r == null || i == null) return { delta: null, falhas: ["Faltam as temperaturas de retorno e insuflamento"] };
  const delta = r - i;
  const falhas =
    delta < min || delta > max
      ? [`ΔT de ${delta.toFixed(1)} °C fora da faixa ${min}–${max} °C`]
      : [];
  return { delta, falhas };
}

/** Minutos entre dois instantes (ms). */
export function minutosEntre(inicio, fim) {
  if (inicio == null || fim == null) return null;
  return (fim - inicio) / 60000;
}
