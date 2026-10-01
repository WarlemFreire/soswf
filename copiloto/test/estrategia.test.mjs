// Testes do motor de estratégia e do aprendizado.
// node copiloto/test/estrategia.test.mjs
import assert from "node:assert/strict";
import * as E from "../js/estrategia.js";
import * as A from "../js/aprendizado.js";
import * as M from "../js/metrics.js";

let passou = 0;
function teste(nome, fn) {
  try {
    fn();
    passou++;
  } catch (erro) {
    console.error(`✗ ${nome}\n  ${erro.message}`);
    process.exitCode = 1;
  }
}

const H = M.HORA;
const T0 = new Date(2026, 9, 1, 14, 0, 0).getTime();
const perto = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

const trecho = (offsetH, duracaoH, valor, extra = {}) => ({
  inicio: T0 + offsetH * H,
  fim: T0 + (offsetH + duracaoH) * H,
  ms: duracaoH * H,
  valor,
  periodo: M.periodoDe(T0 + offsetH * H),
  ...extra,
});

/* ------------------------------------------------------- ociosidade */

teste("trecho longo com pouco ganho vira tempo ocioso", () => {
  const r = E.ociosidade([trecho(0, 0.25, 30), trecho(1, 1.5, 12)]);
  const tarde = r.find((x) => x.periodo === "tarde");
  assert.ok(tarde.horasOciosas > 0, "1h30 sem corrida é ociosidade");
  assert.ok(tarde.fatiaOciosa > 0.5);
});

teste("turno sem trecho longo não acusa ociosidade", () => {
  const r = E.ociosidade([trecho(0, 0.3, 25), trecho(1, 0.4, 30)]);
  assert.equal(r[0].horasOciosas, 0);
});

/* ---------------------------------------------------------- mistura */

teste("amostra pequena não vira conclusão sobre a mistura", () => {
  const r = E.misturaDeCorridas([{ valorBruto: 10, km: 3, timestamp: T0 }]);
  assert.equal(r.suficiente, false, "uma corrida não descreve mistura nenhuma");
});

teste("o corte entre curta e longa sai da mediana dele", () => {
  const corridas = [2, 3, 4, 5, 20, 22, 25, 30].map((km, i) => ({
    id: `c${i}`, timestamp: T0 + i * 60000, valorBruto: km * 3, km, duracaoMin: km * 2,
  }));
  const r = E.misturaDeCorridas(corridas);
  assert.equal(r.suficiente, true);
  assert.ok(r.corteKm >= 5 && r.corteKm <= 20, `corte ${r.corteKm} saiu da mediana`);
  assert.equal(r.curtas.corridas + r.longas.corridas, 8);
  assert.ok(perto(r.curtas.fatia + r.longas.fatia, 1));
});

/* ----------------------------------------------------------- região */

teste("o ganho vai para a célula onde ele passou mais tempo", () => {
  const trilha = [
    { lat: -19.91, lon: -43.93, quando: T0 + 60000 },
    { lat: -19.91, lon: -43.93, quando: T0 + 120000 },
    { lat: -19.95, lon: -43.98, quando: T0 + 180000 },
  ];
  const trechos = [0, 1, 2, 3].map((i) => ({ ...trecho(0, 0.5, 40), inicio: T0, fim: T0 + 600000 }));
  const r = E.porRegiao(trechos, trilha, { minimo: 1 });
  assert.equal(r.length, 1, "uma célula dominante");
  assert.ok(r[0].reaisPorHora > 0);
});

teste("região com pouca amostra não vira recomendação", () => {
  const trilha = [{ lat: -19.91, lon: -43.93, quando: T0 + 60000 }];
  const r = E.porRegiao([{ ...trecho(0, 0.5, 40), inicio: T0, fim: T0 + 600000 }], trilha);
  assert.equal(r.length, 0, "um trecho não descreve uma região");
});

teste("sem rastro não existe análise por região", () => {
  assert.deepEqual(E.porRegiao([trecho(0, 1, 40)], []), []);
});

teste("o rótulo da região não carrega coordenada", () => {
  const trilha = Array.from({ length: 6 }, (_, i) => ({ lat: -19.91, lon: -43.93, quando: T0 + i * 60000 }));
  const trechos = Array.from({ length: 5 }, () => ({ ...trecho(0, 0.5, 40), inicio: T0, fim: T0 + 600000 }));
  const r = E.porRegiao(trechos, trilha, { minimo: 1 });
  assert.ok(/^região \d+$/.test(r[0].regiao), "o nome é neutro");
});

/* ----------------------------------------------------------- padrão */

teste("hora com poucos dias de amostra fica de fora do padrão", () => {
  const r = E.padraoHoraDia([trecho(0, 1, 40)]);
  assert.equal(r.length, 0, "um dia não é padrão");
});

teste("hora com dias suficientes entra, com a amostra declarada", () => {
  const trechos = [0, 1, 2, 3].map((d) => ({
    ...trecho(0, 1, 40),
    inicio: T0 + d * 7 * 24 * H,
    fim: T0 + d * 7 * 24 * H + H,
  }));
  const r = E.padraoHoraDia(trechos);
  assert.equal(r.length, 1);
  assert.equal(r[0].amostraDias, 4);
});

/* ----------------------------------------------------------- aceite */

teste("mede quantas corridas ficaram abaixo do piso do período", () => {
  const ref = { tarde: { hora: { piso: 40, ideal: 55, otimo: 70 } } };
  const corridas = [
    { id: "a", timestamp: T0, valorBruto: 10, km: 4, duracaoMin: 30 }, // 20 R$/h
    { id: "b", timestamp: T0, valorBruto: 40, km: 8, duracaoMin: 30 }, // 80 R$/h
  ];
  const r = E.qualidadeDoAceite(corridas, ref);
  assert.equal(r.comparadas, 2);
  assert.equal(r.abaixoDoPiso, 1);
  assert.equal(r.acimaDoIdeal, 1);
  assert.equal(r.fatiaAbaixoDoPiso, 0.5);
});

teste("sem faixa medida não existe julgamento do aceite", () => {
  assert.equal(E.qualidadeDoAceite([{ id: "a", timestamp: T0, valorBruto: 10, km: 4, duracaoMin: 30 }], null), null);
});

/* ------------------------------------------------------ aprendizado */

const aposta = (extra = {}) => ({
  id: "x", quando: T0, texto: "Rodar mais na tarde", alvo: { tipo: "reaisPorHora" },
  seguiu: null, resultado: null, ...extra,
});

// 1h de passo a partir das 14h: os quatro caem dentro da tarde (12h–18h).
const serie = (inicioOffsetDias, quantos, valorPorHora) =>
  Array.from({ length: quantos }, (_, i) => ({
    inicio: T0 + inicioOffsetDias * 86400000 + i * H,
    fim: T0 + inicioOffsetDias * 86400000 + i * H + (H * 0.9),
    ms: H,
    valor: valorPorHora,
    periodo: "tarde",
  }));

teste("melhora acima do ruído conta como rendeu", () => {
  const trechos = [...serie(-5, 4, 30), ...serie(1, 4, 45)];
  const m = A.medir(aposta(), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.RENDEU);
  assert.ok(m.diferencaPct > 8);
});

teste("piora conta como não rendeu", () => {
  const trechos = [...serie(-5, 4, 50), ...serie(1, 4, 30)];
  const m = A.medir(aposta(), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.NAO_RENDEU);
});

teste("diferença pequena é ruído, não efeito", () => {
  const trechos = [...serie(-5, 4, 40), ...serie(1, 4, 41)];
  const m = A.medir(aposta(), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.IGUAL, "2,5% não é melhora");
});

teste("se ele não seguiu, não existe resultado — nem bom nem ruim", () => {
  const trechos = [...serie(-5, 4, 30), ...serie(1, 4, 60)];
  const m = A.medir(aposta({ seguiu: false }), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.SEM_DADO);
  assert.equal(m.motivo, "não seguiu");
});

teste("sem jornada suficiente depois, fica sem dado em vez de virar fracasso", () => {
  const trechos = serie(-5, 4, 30);
  const m = A.medir(aposta(), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.SEM_DADO);
});

teste("o juiz é a aritmética: a aposta só mede o período que ela declarou", () => {
  const manha = serie(1, 4, 90).map((t) => ({ ...t, inicio: t.inicio - 5 * H, periodo: "manha" }));
  const trechos = [...serie(-5, 4, 30), ...serie(1, 4, 31), ...manha];
  const m = A.medir(aposta({ alvo: { tipo: "reaisPorHora", periodo: "tarde" } }), trechos, T0 + 10 * 86400000);
  assert.equal(m.resultado, A.RESULTADOS.IGUAL, "a manhã ótima não pode salvar uma aposta da tarde");
});

teste("o placar conta e traz exemplos dos dois lados", () => {
  const p = A.placar([
    { quando: T0, texto: "a", resultado: A.RESULTADOS.RENDEU, diferencaPct: 20 },
    { quando: T0, texto: "b", resultado: A.RESULTADOS.NAO_RENDEU, diferencaPct: -15 },
    { quando: T0, texto: "c", resultado: A.RESULTADOS.IGUAL },
    { quando: T0, texto: "d", resultado: A.RESULTADOS.SEM_DADO },
  ], T0 + 86400000);
  assert.equal(p.total, 4);
  assert.equal(p.renderam, 1);
  assert.equal(p.naoRenderam, 1);
  assert.equal(p.exemplos.length, 2, "só os que têm veredito viram exemplo");
});

teste("aposta velha sai do placar", () => {
  const p = A.placar([{ quando: T0, texto: "a", resultado: A.RESULTADOS.RENDEU }], T0 + 200 * 86400000);
  assert.equal(p.total, 0, "três meses atrás não descreve mais a cidade nem ele");
});

console.log(`✓ ${passou} testes passaram`);
