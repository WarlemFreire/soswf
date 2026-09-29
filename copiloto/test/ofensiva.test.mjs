// Testes da ofensiva. node copiloto/test/ofensiva.test.mjs
import assert from "node:assert/strict";
import * as C from "../js/ofensiva.js";
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

teste("jornada aberta hoje já conta na ofensiva", () => {
  const hoje = emDia(3, 20).getTime();
  const aberta = dia(3);
  aberta.jornadas[0].jornada.horaFim = null;
  const o = C.ofensiva([dia(1), dia(2), aberta], hoje);
  assert.equal(o.trabalhouHoje, true);
  assert.equal(o.atual, 3);
});

console.log(`✓ ${passou} testes passaram`);
