// Testes de nível, XP e moedas. node copiloto/test/progresso.test.mjs
import assert from "node:assert/strict";
import * as P from "../js/progresso.js";
import * as C from "../js/conquistas.js";

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

const vazio = C.estatisticas({});

teste("nível 1 começa em zero e a curva encarece", () => {
  assert.equal(P.nivelDe(0).nivel, 1);
  assert.equal(P.nivelDe(249).nivel, 1);
  assert.equal(P.nivelDe(250).nivel, 2, "o nível 2 custa 250");
  assert.equal(P.nivelDe(749).nivel, 2);
  assert.equal(P.nivelDe(750).nivel, 3, "o 3 custa mais 500");
  assert.equal(P.nivelDe(1500).nivel, 4);
  assert.ok(P.nivelDe(1e6).nivel > P.nivelDe(1e5).nivel, "a curva nunca trava");
});

teste("o que falta fecha com o que já anda no nível", () => {
  const n = P.nivelDe(900);
  assert.equal(n.noNivel + n.faltam, n.custo);
  assert.equal(n.base + n.custo, n.proximo);
  assert.ok(n.progresso > 0 && n.progresso < 1);
});

teste("XP negativo ou lixo não quebra o nível", () => {
  for (const entrada of [-100, null, undefined, NaN, "abc"]) {
    const n = P.nivelDe(entrada);
    assert.equal(n.nivel, 1);
    assert.equal(n.xp, 0);
  }
});

teste("cada patente paga a sua faixa", () => {
  const uma = (patente) => {
    const m = C.MEDALHAS.find((x) => x.patente === patente);
    return C.avaliar({ ...vazio }).find((x) => x.id === m.id);
  };
  for (let patente = 1; patente <= 5; patente++) {
    assert.equal(uma(patente).xp, C.XP_POR_PATENTE[patente - 1], `patente ${patente}`);
  }
  assert.ok(C.XP_POR_PATENTE[4] > C.XP_POR_PATENTE[0] * 8, "diamante tem que valer o esforço");
});

teste("XP soma missões, dias, metas e recorde de ofensiva", () => {
  const est = { ...vazio, dias: 10, metas: { minima: 4, ideal: 2, otima: 1 }, ofensivaRecorde: 5 };
  const avaliadas = C.avaliar(est);
  const xp = P.xpDetalhado(avaliadas, est);

  assert.equal(xp.dias, 10 * P.XP_DIA);
  assert.equal(xp.metas, 4 * P.XP_META.minima + 2 * P.XP_META.ideal + 1 * P.XP_META.otima);
  assert.equal(xp.ofensiva, 5 * P.XP_POR_DIA_DE_OFENSIVA);
  assert.equal(xp.total, xp.missoes + xp.dias + xp.metas + xp.ofensiva);
  assert.equal(
    xp.missoes,
    avaliadas.filter((m) => m.conquistada).reduce((s, m) => s + m.xp, 0)
  );
});

teste("app zerado não deve nem paga XP", () => {
  const xp = P.xpDetalhado(C.avaliar(vazio), vazio);
  assert.equal(xp.total, 0);
  assert.equal(P.moedasDe(C.avaliar(vazio), vazio), 0);
  assert.equal(P.nivelDe(xp.total).nivel, 1);
});

teste("nível não desce quando a ofensiva cai", () => {
  // A ofensiva ATUAL zera quando o motorista descansa demais. Se o XP olhasse
  // para ela, o nível cairia junto — progressão conquistada não se devolve.
  const base = { ...vazio, dias: 20, ofensivaRecorde: 12 };
  const cheio = P.progresso(C.avaliar({ ...base, ofensiva: 12 }), { ...base, ofensiva: 12 });
  const parado = P.progresso(C.avaliar({ ...base, ofensiva: 0 }), { ...base, ofensiva: 0 });
  assert.equal(parado.xp.total, cheio.xp.total);
  assert.equal(parado.nivel.nivel, cheio.nivel.nivel);
});

teste("moedas contam missão e dia", () => {
  const est = { ...vazio, dias: 8 };
  const avaliadas = C.avaliar(est);
  const cumpridas = avaliadas.filter((m) => m.conquistada).length;
  assert.equal(P.moedasDe(avaliadas, est), cumpridas * P.MOEDA_POR_MISSAO + 8 * P.MOEDA_POR_DIA);
});

teste("descrição de missão é objetivo, não estatística", () => {
  // "100 horas rodadas" descreve um fato; "Rodar 100 horas" convida a fazer.
  const verbos = /^(Rodar|Acumular|Registrar|Fechar|Chegar|Detalhar|Fazer|Pegar|Somar|Bater|Trabalhar)/;
  const fora = C.MEDALHAS.filter((m) => !verbos.test(m.descricao));
  assert.equal(fora.length, 0, `sem verbo de ação: ${fora.slice(0, 3).map((m) => m.descricao).join(" | ")}`);
});

teste("toda medalha tem prêmio e patente", () => {
  assert.ok(C.MEDALHAS.every((m) => m.xp > 0 && m.patente >= 1 && m.patente <= 5));
  assert.equal(C.nomeDaPatente(1), "Bronze");
  assert.equal(C.nomeDaPatente(5), "Diamante");
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
