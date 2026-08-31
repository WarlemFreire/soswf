// Testes da gamificação. node copiloto/test/conquistas.test.mjs
import assert from "node:assert/strict";
import * as C from "../js/conquistas.js";
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

// 2026-08-24 é uma segunda-feira.
const emDia = (offset, hora = 14) => new Date(2026, 7, 24 + offset, hora, 0, 0, 0);
const chave = (offset) => M.chaveData(emDia(offset).getTime());

function dia(offset, extra = {}) {
  const inicio = emDia(offset, 14).getTime();
  return {
    data: chave(offset),
    inicio,
    saldo: 300,
    km: 150,
    msAtivo: 8 * H,
    reaisPorHora: 37.5,
    reaisPorKm: 2,
    corridas: [],
    jornadas: [
      {
        jornada: { id: `j${offset}`, data: chave(offset), horaInicio: inicio, horaFim: inicio + 8 * H },
        pausas: [],
        msAtivo: 8 * H,
      },
    ],
    ...extra,
  };
}

/* ---------------------------------------------------------------- ofensiva */

teste("ofensiva conta dias seguidos", () => {
  const dias = [dia(0), dia(1), dia(2)];
  const o = C.ofensiva(dias, emDia(2).getTime());
  assert.equal(o.atual, 3);
  assert.equal(o.recorde, 3);
  assert.equal(o.trabalhouHoje, true);
  assert.equal(o.folgasRestantes, 2);
});

teste("dois dias de folga não quebram a ofensiva", () => {
  // trabalhou dia 0, folgou 1 e 2, voltou no 3
  const dias = [dia(0), dia(3)];
  const o = C.ofensiva(dias, emDia(3).getTime());
  assert.equal(o.viva, true);
  assert.equal(o.atual, 2, "os dois dias contam como uma corrente só");
});

teste("três dias de folga quebram", () => {
  const dias = [dia(0), dia(4)];
  const o = C.ofensiva(dias, emDia(4).getTime());
  assert.equal(o.atual, 1, "a corrente recomeçou no dia 4");
  assert.equal(o.recorde, 1);
});

teste("ofensiva segue viva na folga e some depois dela", () => {
  const dias = [dia(0), dia(1), dia(2)];
  const dentro = C.ofensiva(dias, emDia(4).getTime()); // parado há 2 dias
  assert.equal(dentro.viva, true);
  assert.equal(dentro.atual, 3);
  assert.equal(dentro.folgasRestantes, 1);
  assert.equal(dentro.trabalhouHoje, false);

  const fora = C.ofensiva(dias, emDia(6).getTime()); // parado há 4 dias
  assert.equal(fora.viva, false);
  assert.equal(fora.atual, 0);
  assert.equal(fora.recorde, 3, "o recorde não se perde");
  assert.equal(fora.folgasRestantes, 0);
});

teste("ofensiva sem histórico não explode", () => {
  const o = C.ofensiva([], Date.now());
  assert.equal(o.atual, 0);
  assert.equal(o.recorde, 0);
});

teste("duas jornadas no mesmo dia contam um dia só", () => {
  const dias = [dia(0), { ...dia(0) }, dia(1)];
  assert.equal(C.ofensiva(dias, emDia(1).getTime()).atual, 2);
});

/* ---------------------------------------------------------------- recordes */

teste("recordes apontam o dia certo", () => {
  const dias = [dia(0), dia(1, { saldo: 800 }), dia(2, { km: 400 })];
  const r = C.recordes(dias, [], []);
  const lucro = r.find((x) => x.nome === "Dia mais lucrativo");
  assert.equal(lucro.quando, chave(1));
  assert.ok(lucro.valor.includes("800"));
  const km = r.find((x) => x.nome === "Mais km num dia");
  assert.equal(km.quando, chave(2));
  assert.equal(km.valor, "400 km");
  const rh = C.recordes([dia(0)], [], []).find((x) => x.nome === "Melhor R$/hora num dia");
  assert.equal(rh.valor, "R$ 38", "o rótulo já diz a unidade");
});

teste("recorde sem dado vira valor nulo e não some da lista", () => {
  const r = C.recordes([], [], []);
  assert.equal(r.length, 8);
  assert.ok(r.every((x) => x.valor === null));
});

teste("jornada importada da planilha não vira recorde de duração", () => {
  const inicio = emDia(0).getTime();
  const historico = [
    { jornada: { data: chave(0), horaInicio: inicio, horaFim: inicio + 20 * H, origem: "planilha" } },
    { jornada: { data: chave(1), horaInicio: inicio, horaFim: inicio + 6 * H } },
  ];
  const r = C.recordes([], [], historico).find((x) => x.nome === "Jornada mais longa");
  assert.equal(r.quando, chave(1), "a janela da planilha não é jornada trabalhada");
});

/* ----------------------------------------------------------- estatísticas */

teste("horas se espalham pelas horas de relógio", () => {
  const inicio = new Date(2026, 7, 24, 22, 0).getTime(); // 22h → 4h
  const dias = [
    {
      data: chave(0),
      inicio,
      saldo: 300,
      km: 100,
      msAtivo: 6 * H,
      corridas: [],
      jornadas: [{ jornada: { horaInicio: inicio, horaFim: inicio + 6 * H }, pausas: [], msAtivo: 6 * H }],
    },
  ];
  const e = C.estatisticas({ dias });
  assert.ok(perto(e.horas, 6));
  assert.ok(perto(e.horasMadrugada, 4), "de meia-noite às 4h são 4 horas");
  assert.ok(perto(e.horasPorPeriodo.pico, 4), "22h-2h é pico");
  assert.ok(perto(e.horasPorPeriodo.madrugada, 2), "2h-4h é madrugada");
  assert.deepEqual([...e.horasVisitadas].sort((a, b) => a - b), [0, 1, 2, 3, 22, 23]);
});

teste("pausa sai da conta de horas", () => {
  const inicio = new Date(2026, 7, 24, 10, 0).getTime();
  const dias = [
    {
      data: chave(0),
      inicio,
      saldo: 100,
      km: 50,
      msAtivo: 3 * H,
      corridas: [],
      jornadas: [
        {
          jornada: { horaInicio: inicio, horaFim: inicio + 4 * H },
          pausas: [{ horaInicio: inicio + 1 * H, horaFim: inicio + 2 * H }],
          msAtivo: 3 * H,
        },
      ],
    },
  ];
  const e = C.estatisticas({ dias });
  assert.ok(perto(e.horas, 3));
  assert.ok(perto(e.horasPorHora[11], 0), "a hora inteira de pausa não conta");
});

teste("dia da planilha é reescalado pelo tempo informado", () => {
  const inicio = new Date(2026, 7, 24, 8, 0).getTime();
  const dias = [
    {
      data: chave(0),
      inicio,
      saldo: 400,
      km: 200,
      msAtivo: 5 * H, // informado na planilha
      corridas: [],
      jornadas: [
        {
          // janela da primeira à última corrida: 10 horas
          jornada: { horaInicio: inicio, horaFim: inicio + 10 * H, origem: "planilha" },
          pausas: [],
          msAtivo: 5 * H,
        },
      ],
    },
  ];
  const e = C.estatisticas({ dias });
  assert.ok(perto(e.horas, 5), "vale o tempo informado, não a janela");
  assert.equal(e.horasVisitadas.size, 10, "mas as horas visitadas continuam sendo as 10");
});

teste("estatísticas agregam o resto", () => {
  const corridas = [
    { plataforma: "uber", valorBruto: 30, valorDinamico: 5, bairroOrigem: "Luz" },
    { plataforma: "uber", valorBruto: 20, valorDinamico: 0, bairroOrigem: "luz" },
    { plataforma: "99", valorBruto: 40, valorDinamico: 10, bairroOrigem: "Sé" },
    { plataforma: "indrive", valorBruto: 25, valorDinamico: 0, bairroOrigem: "?" },
  ];
  const custos = [{ tipo: "gnv" }, { tipo: "gasolina" }, { tipo: "lavagem" }];
  const historico = [
    { pausas: [{ horaFim: 1 }, { horaFim: null }], registros: [{}, {}, {}] },
    { pausas: [{ horaFim: 1 }], registros: [{}] },
  ];
  const e = C.estatisticas({ dias: [dia(0), dia(1, { saldo: 500 })], historico, corridas, custos });

  assert.equal(e.dias, 2);
  assert.equal(e.bruto, 800);
  assert.equal(e.maiorBrutoDia, 500);
  assert.equal(e.km, 300);
  assert.equal(e.maiorKmDia, 150);
  assert.equal(e.corridas, 4);
  assert.deepEqual(e.porPlataforma, { uber: 2, "99": 1, indrive: 1 });
  assert.equal(e.bairros, 2, "Luz e luz são o mesmo bairro; ? não conta");
  assert.equal(e.dinamico, 15);
  assert.equal(e.abastecimentos, 2, "lavagem não é combustível");
  assert.equal(e.pausas, 2, "pausa aberta não conta");
  assert.equal(e.registros, 4);
  assert.equal(e.diasSemana[1], 1, "segunda");
  assert.equal(e.diasSemana[2], 1, "terça");
});

teste("metas batidas contam por dia", () => {
  const comMeta = (offset, saldo) => {
    const d = dia(offset, { saldo });
    Object.assign(d.jornadas[0].jornada, { metaMinima: 280, metaIdeal: 350, metaOtima: 450 });
    return d;
  };
  const e = C.estatisticas({ dias: [comMeta(0, 300), comMeta(1, 500), comMeta(2, 100)] });
  assert.deepEqual(e.metas, { minima: 2, ideal: 1, otima: 1 });
});

/* ---------------------------------------------------------------- medalhas */

teste("catálogo tem centenas de medalhas com id único", () => {
  assert.ok(C.MEDALHAS.length >= 200, `só ${C.MEDALHAS.length}`);
  assert.equal(new Set(C.MEDALHAS.map((m) => m.id)).size, C.MEDALHAS.length);
  assert.equal(new Set(C.MEDALHAS.map((m) => m.nome)).size, C.MEDALHAS.length, "nome ambíguo no toast");
  assert.ok(C.MEDALHAS.every((m) => m.alvo > 0 && m.familia && m.descricao));
});

teste("catálogo zerado não conquista nada e não quebra", () => {
  const a = C.avaliar(C.estatisticas({}));
  assert.equal(a.filter((m) => m.conquistada).length, 0);
  assert.ok(a.every((m) => m.progresso === 0));
});

teste("rei da madrugada sai com 100 horas entre meia-noite e 6h", () => {
  const rei = C.avaliar({ ...C.estatisticas({}), horasMadrugada: 100 }).find((m) => m.nome === "Rei da Madrugada");
  assert.ok(rei, "medalha não existe");
  assert.equal(rei.conquistada, true);
  assert.ok(rei.descricao.includes("meia-noite"));

  const quase = C.avaliar({ ...C.estatisticas({}), horasMadrugada: 50 }).find((m) => m.nome === "Rei da Madrugada");
  assert.equal(quase.conquistada, false);
  assert.ok(perto(quase.progresso, 0.5));
});

teste("degraus da mesma família caem em ordem", () => {
  const a = C.avaliar({ ...C.estatisticas({}), bruto: 12000 });
  const fam = C.porFamilia(a).find((f) => f.nome === "Faturamento");
  assert.equal(fam.conquistadas, 3, "1k, 5k e 10k");
  assert.equal(fam.atual.alvo, 10000);
  assert.equal(fam.proxima.alvo, 25000);
});

teste("nenhuma medalha olha para medida que pode cair", () => {
  // A ofensiva atual cai quando o motorista para; a medalha tem que olhar
  // para o recorde, senão o troféu é revogado.
  const base = C.estatisticas({});
  const cheio = { ...base, ofensiva: 30, ofensivaRecorde: 30 };
  const parou = { ...base, ofensiva: 0, ofensivaRecorde: 30 };
  const ganhas = (e) => C.avaliar(e).filter((m) => m.conquistada).map((m) => m.id);
  assert.deepEqual(ganhas(parou), ganhas(cheio));
});

teste("coleção do relógio marca as horas visitadas", () => {
  const e = { ...C.estatisticas({}), horasVisitadas: new Set([0, 3, 23]) };
  const relogio = C.avaliar(e).filter((m) => m.familia === "Volta ao Relógio");
  assert.equal(relogio.length, 24);
  assert.equal(relogio.filter((m) => m.conquistada).length, 3);
  assert.equal(relogio.find((m) => m.nome === "03h").conquistada, true);
  assert.equal(relogio.find((m) => m.nome === "04h").conquistada, false);
});

teste("próximas são as mais perto de cair", () => {
  const a = C.avaliar({ ...C.estatisticas({}), corridas: 9, bruto: 100 });
  const p = C.proximas(a, 3);
  assert.equal(p[0].nome, "10 Corridas", "90% do caminho");
  assert.ok(p.every((m) => !m.conquistada));
  assert.ok(p[0].progresso >= p[1].progresso);
});

teste("resumo bate com o catálogo", () => {
  const a = C.avaliar({ ...C.estatisticas({}), dias: 1 });
  const r = C.resumoMedalhas(a);
  assert.equal(r.total, C.MEDALHAS.length);
  assert.equal(r.conquistadas + r.restantes, r.total);
  assert.ok(r.conquistadas >= 1);
});

teste("jornada aberta hoje já conta na ofensiva", () => {
  const hoje = emDia(3, 20).getTime();
  const aberta = dia(3);
  aberta.jornadas[0].jornada.horaFim = null;
  const o = C.ofensiva([dia(1), dia(2), aberta], hoje);
  assert.equal(o.trabalhouHoje, true);
  assert.equal(o.atual, 3);
});

teste("estatísticas de uma jornada ainda aberta não quebram", () => {
  const inicio = Date.now() - 3 * H;
  const dias = [
    {
      data: M.chaveData(inicio),
      inicio,
      saldo: 120,
      km: 40,
      msAtivo: 3 * H,
      corridas: [],
      jornadas: [{ jornada: { horaInicio: inicio, horaFim: null }, pausas: [], msAtivo: 3 * H }],
    },
  ];
  const e = C.estatisticas({ dias });
  assert.ok(perto(e.horas, 3, 0.05));
  assert.ok(e.horasVisitadas.size >= 3);
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
