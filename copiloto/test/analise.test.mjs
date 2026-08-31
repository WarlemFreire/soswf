// Testes dos cálculos da Análise. node copiloto/test/analise.test.mjs
import assert from "node:assert/strict";
import * as A from "../js/analise.js";
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
const perto = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const H = M.HORA;

const emDia = (dia, hora, extra = {}) => ({
  // 2026-08-24 é uma segunda-feira; somamos dias a partir dela.
  timestamp: new Date(2026, 7, 24 + dia, hora, 15).getTime(),
  valorBruto: 20,
  valorDinamico: 0,
  km: 5,
  duracaoMin: 12,
  bairroOrigem: "Luz",
  ...extra,
});

teste("por dia da semana separa e faz média por dia", () => {
  const dias = [
    { inicio: new Date(2026, 7, 24, 14).getTime(), saldo: 200, msAtivo: 5 * H }, // segunda
    { inicio: new Date(2026, 7, 31, 14).getTime(), saldo: 300, msAtivo: 5 * H }, // segunda
    { inicio: new Date(2026, 7, 29, 14).getTime(), saldo: 400, msAtivo: 8 * H }, // sábado
  ];
  const r = A.porDiaDaSemana(dias);
  const seg = r.find((x) => x.nome === "Seg");
  const sab = r.find((x) => x.nome === "Sáb");
  assert.equal(seg.dias, 2);
  assert.equal(seg.brutoMedio, 250);
  assert.ok(perto(seg.reaisPorHora, 50), `deu ${seg.reaisPorHora}`);
  assert.ok(perto(sab.reaisPorHora, 50));
  assert.equal(r.find((x) => x.nome === "Dom").reaisPorHora, null, "domingo sem dado não inventa zero");
});

teste("dia sem tempo medido entra no bruto mas não no R$/hora", () => {
  const dias = [{ inicio: new Date(2026, 7, 24, 14).getTime(), saldo: 200, msAtivo: null }];
  const seg = A.porDiaDaSemana(dias).find((x) => x.nome === "Seg");
  assert.equal(seg.brutoMedio, 200);
  assert.equal(seg.reaisPorHora, null);
});

teste("trecho espalha o valor pelas horas que atravessa", () => {
  // Jornada das 20h às 22h com um único checkpoint de R$60 no fim: 30 por hora.
  const inicio = new Date(2026, 7, 24, 20, 0).getTime();
  const jornada = { id: "j1", data: "d", horaInicio: inicio, saldoInicial: {} };
  const registros = [{ id: "r1", jornadaId: "j1", timestamp: inicio + 2 * H, saldos: { uber: 60 } }];
  const horas = A.porHoraDosTrechos([jornada], registros);
  assert.ok(perto(horas[20].valor, 30), `20h deu ${horas[20].valor}`);
  assert.ok(perto(horas[21].valor, 30), `21h deu ${horas[21].valor}`);
  assert.equal(horas[19].valor, 0);
  assert.ok(perto(horas[20].reaisPorHora, 30));
});

teste("trecho parcial reparte proporcional ao pedaço da hora", () => {
  // 20h30 às 21h30 com R$40: metade em cada hora.
  const inicio = new Date(2026, 7, 24, 20, 30).getTime();
  const jornada = { id: "j1", data: "d", horaInicio: inicio, saldoInicial: {} };
  const registros = [{ id: "r1", jornadaId: "j1", timestamp: inicio + H, saldos: { uber: 40 } }];
  const horas = A.porHoraDosTrechos([jornada], registros);
  assert.ok(perto(horas[20].valor, 20), `20h deu ${horas[20].valor}`);
  assert.ok(perto(horas[21].valor, 20), `21h deu ${horas[21].valor}`);
});

teste("faixa horária das corridas usa a hora do recibo", () => {
  const corridas = [emDia(0, 22, { valorBruto: 30, km: 5 }), emDia(0, 22, { valorBruto: 20, km: 5 }), emDia(0, 15, { valorBruto: 10, km: 10 })];
  const horas = A.porFaixaHoraria(corridas);
  assert.equal(horas[22].n, 2);
  assert.equal(horas[22].valor, 50);
  assert.ok(perto(horas[22].reaisPorKm, 5));
  assert.ok(perto(horas[15].reaisPorKm, 1));
  assert.equal(horas[3].reaisPorKm, null, "hora sem corrida não vira zero");
});

teste("heatmap põe cada corrida no dia e hora certos", () => {
  const m = A.heatmapHoraDia([emDia(0, 22), emDia(5, 22), emDia(5, 22)]);
  assert.equal(m[1][22].n, 1, "segunda 22h");
  assert.equal(m[6][22].n, 2, "sábado 22h");
  assert.equal(m[6][22].valor, 40);
  assert.equal(m[0][3].n, 0);
});

teste("ranking de bairro exige um mínimo de corridas", () => {
  const corridas = [
    emDia(0, 20, { bairroOrigem: "Luz", valorBruto: 30, km: 5 }),
    emDia(0, 21, { bairroOrigem: "Luz", valorBruto: 30, km: 5 }),
    emDia(0, 22, { bairroOrigem: "Centro", valorBruto: 90, km: 5 }),
    emDia(0, 23, { bairroOrigem: "?", valorBruto: 50, km: 5 }),
    emDia(0, 23, { bairroOrigem: "", valorBruto: 50, km: 5 }),
  ];
  const r = A.porBairro(corridas, { minimo: 2 });
  assert.equal(r.length, 1, "Centro tem uma só, e ? e vazio ficam de fora");
  assert.equal(r[0].nome, "Luz");
  assert.ok(perto(r[0].reaisPorKm, 6));
});

teste("longa vs curta separa pelo corte de km", () => {
  const corridas = [
    emDia(0, 20, { km: 10, valorBruto: 25, duracaoMin: 25 }),
    emDia(0, 21, { km: 3, valorBruto: 15, duracaoMin: 10 }),
    emDia(0, 22, { km: 2, valorBruto: 12, duracaoMin: 8 }),
  ];
  const r = A.longaVsCurta(corridas, 5);
  assert.equal(r.longa.n, 1);
  assert.equal(r.curta.n, 2);
  assert.ok(perto(r.longa.reaisPorKm, 2.5));
  assert.ok(perto(r.curta.reaisPorKm, 27 / 5));
  assert.ok(r.curta.reaisPorKm > r.longa.reaisPorKm, "curta rende mais por km nestes dados");
});

teste("impacto do dinâmico compara com e sem", () => {
  const corridas = [
    emDia(0, 22, { valorBruto: 30, valorDinamico: 12, km: 5 }),
    emDia(0, 22, { valorBruto: 10, valorDinamico: 0, km: 5 }),
  ];
  const r = A.impactoDinamico(corridas);
  assert.ok(perto(r.fatia, 12 / 40));
  assert.equal(r.com.n, 1);
  assert.equal(r.sem.n, 1);
  assert.ok(perto(r.com.reaisPorKm, 6));
  assert.ok(perto(r.sem.reaisPorKm, 2));
});

teste("pausas somam por motivo, ignorando a que ainda está aberta", () => {
  const t = new Date(2026, 7, 24, 20).getTime();
  const dias = [
    {
      jornadas: [
        {
          pausas: [
            { motivo: "almoco", horaInicio: t, horaFim: t + 40 * M.MINUTO },
            { motivo: "almoco", horaInicio: t + 2 * H, horaFim: t + 2 * H + 20 * M.MINUTO },
            { motivo: "banheiro", horaInicio: t + 3 * H, horaFim: t + 3 * H + 5 * M.MINUTO },
            { motivo: "descanso", horaInicio: t + 4 * H, horaFim: null },
          ],
        },
      ],
    },
  ];
  const r = A.porMotivoDePausa(dias);
  assert.equal(r[0].motivo, "almoco");
  assert.equal(r[0].n, 2);
  assert.ok(perto(r[0].ms / M.MINUTO, 60));
  assert.equal(r.length, 2, "a pausa aberta não entra");
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
