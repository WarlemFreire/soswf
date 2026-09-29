// Testes do semáforo de ofertas. node copiloto/test/semaforo.test.mjs
//
// O que está sob teste aqui é a parte que já errou duas vezes neste projeto:
// de onde saem os cortes. O parser de tela e o desenho do selo são Java e não
// chegam aqui — mas a decisão financeira, sim.
import assert from "node:assert/strict";
import * as S from "../js/semaforo.js";

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

// 14h de uma sexta cai na faixa "tarde".
const TARDE = new Date(2026, 8, 25, 14, 0, 0).getTime();
const MADRUGADA = new Date(2026, 8, 25, 4, 0, 0).getTime();

const faixa = (piso, ideal, otimo) => ({ piso, ideal, otimo });

const aceiteCheio = {
  tarde: { n: 40, hora: faixa(34, 46, 62), km: faixa(2.9, 3.4, 4.1) },
  madrugada: { n: 20, hora: faixa(28, 38, 52), km: faixa(3.1, 3.7, 4.6) },
};

const semConfig = { mixGnvPct: 100, precoGnv: 0, kmPorM3: 0, kmPorLitro: 0, precoEtanol: 0, custoDesgasteKm: 0 };

teste("sem amostra não existe corte, e isso é o certo", () => {
  assert.equal(S.cortesAgora(TARDE, { aceite: {}, config: semConfig }), null);
  assert.equal(S.cortesAgora(TARDE, { aceite: { tarde: { n: 2, hora: null, km: null } }, config: semConfig }), null);
});

teste("os cortes saem da faixa horária do momento", () => {
  const c = S.cortesAgora(TARDE, { aceite: aceiteCheio, config: semConfig });
  assert.equal(c.periodo, "tarde");
  assert.equal(c.pisoHora, 34);
  assert.equal(c.idealHora, 46);
  assert.equal(c.otimoHora, 62);
});

teste("faixa horária diferente, corte diferente", () => {
  const tarde = S.cortesAgora(TARDE, { aceite: aceiteCheio, config: semConfig });
  const madrugada = S.cortesAgora(MADRUGADA, { aceite: aceiteCheio, config: semConfig });
  assert.equal(madrugada.periodo, "madrugada");
  assert.notEqual(tarde.pisoHora, madrugada.pisoHora);
});

teste("o piso NÃO é a mediana — foi esse o erro que mandava recusar tudo", () => {
  const c = S.cortesAgora(TARDE, { aceite: aceiteCheio, config: semConfig });
  // O piso é percentil baixo: tem que ficar abaixo do ideal, que é o do meio.
  assert.ok(c.pisoHora < c.idealHora, "piso acima do ideal reprovaria metade das ofertas");
  assert.ok(c.idealHora < c.otimoHora);
});

teste("o piso por km vem da escala de CORRIDA, não da jornada", () => {
  const c = S.cortesAgora(TARDE, { aceite: aceiteCheio, config: semConfig });
  // Escala de corrida vive perto de 3; a da jornada, perto de 1,9. Um piso de
  // corrida abaixo de 2,5 é sinal de que a escala errada entrou.
  assert.ok(c.pisoKm > 2.5, `piso por km ${c.pisoKm} parece ser da jornada, não da oferta`);
});

teste("custo por km entra como chão absoluto", () => {
  const c = S.cortesAgora(TARDE, {
    aceite: aceiteCheio,
    config: { mixGnvPct: 95, precoGnv: 4.3, kmPorM3: 10, kmPorLitro: 8, precoEtanol: 4.2, custoDesgasteKm: 0.25 },
  });
  assert.ok(c.custoKm > 0, "sem custo não existe chão de prejuízo");
  assert.ok(c.custoKm < c.pisoKm, "o chão de custo tem que ficar abaixo do piso medido");
});

teste("faixa sem km ainda produz corte de hora", () => {
  const c = S.cortesAgora(TARDE, {
    aceite: { tarde: { n: 15, hora: faixa(30, 40, 55), km: null } },
    config: semConfig,
  });
  assert.equal(c.pisoHora, 30);
  assert.equal(c.pisoKm, 0, "sem km medido o corte por km é zero, não um chute");
});

teste("na web o semáforo não está disponível", () => {
  assert.equal(S.disponivel(), false);
});

teste("resumo conta e soma por veredito", () => {
  const r = S.resumoDeOfertas([
    { veredito: "recusar", valor: 6 },
    { veredito: "recusar", valor: 8 },
    { veredito: "boa", valor: 22 },
    { veredito: "otima", valor: 41 },
    { veredito: "fraca", valor: 13 },
  ]);
  assert.equal(r.total, 5);
  assert.equal(r.recusar, 2);
  assert.equal(r.somaRecusadas, 14);
  assert.equal(r.somaBoas, 76);
});

teste("resumo sem oferta não quebra", () => {
  const r = S.resumoDeOfertas([]);
  assert.equal(r.total, 0);
  assert.equal(r.somaBoas, 0);
});

teste("veredito desconhecido não contamina o resumo", () => {
  const r = S.resumoDeOfertas([{ veredito: "sei-la", valor: 10 }]);
  assert.equal(r.total, 1);
  assert.equal(r.recusar, 0);
});

console.log(`✓ ${passou} testes passaram`);
