// Testes do orçamento de corrida particular. node copiloto/test/orcamento.test.mjs
import assert from "node:assert/strict";
import * as O from "../js/orcamento.js";

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

// GNV a 4,30/m³ rendendo 10 km/m³ = 0,43/km, mais 0,25 de desgaste = 0,68/km.
const config = {
  mixGnvPct: 100, precoGnv: 4.3, kmPorM3: 10,
  kmPorLitro: 8, precoEtanol: 4.2, custoDesgasteKm: 0.25,
};
const perto = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

teste("o custo conta o km TOTAL, não só o da viagem", () => {
  const o = O.orcar({ km: 20, minutos: 40, kmAteCliente: 5, config, alvoHora: 40 });
  assert.equal(o.kmTotal, 45, "5 de ida + 20 de viagem + 20 de volta vazia");
  assert.ok(perto(o.custo, 45 * 0.68), `custo veio ${o.custo}`);
});

teste("sem volta vazia o km total cai", () => {
  const o = O.orcar({ km: 20, minutos: 40, voltaVazio: false, config, alvoHora: 40 });
  assert.equal(o.kmTotal, 20);
});

teste("o tempo morto entra na conta por tempo", () => {
  const o = O.orcar({ km: 30, minutos: 45, kmAteCliente: 10, minutosEspera: 15, config, alvoHora: 40 });
  // 45 de viagem + 15 de espera + (10 km ida + 30 km volta) a 30 km/h = 80 min
  assert.ok(o.minutosTotal > 45 + 15, "o deslocamento tem que aparecer no tempo");
  assert.ok(perto(o.minutosMorto, 80), `morto veio ${o.minutosMorto}`);
});

teste("vale a MAIOR das duas contas, nunca a média", () => {
  const o = O.orcar({ km: 10, minutos: 60, config, alvoHora: 50 });
  const media = (o.porTempo + o.porCusto) / 2;
  assert.ok(o.preco >= o.porTempo - 5, "não pode ficar abaixo da conta por tempo");
  assert.ok(o.preco >= o.porCusto - 5, "nem abaixo da conta por custo");
  assert.ok(o.preco > media, "média aceitaria preço que falha numa das restrições");
});

teste("corrida devagar é mandada pelo tempo", () => {
  // 8 km em 50 min: trânsito. O km é pouco, o tempo é muito.
  const o = O.orcar({ km: 8, minutos: 50, config, alvoHora: 45 });
  assert.equal(o.manda, "tempo");
});

teste("corrida longa e rápida é mandada pelo custo", () => {
  // 80 km em 60 min: rodovia. Muito km, pouco tempo.
  const o = O.orcar({ km: 80, minutos: 60, config, alvoHora: 20, margemPct: 150 });
  assert.equal(o.manda, "custo");
});

teste("o preço arredonda para cima, nunca para baixo", () => {
  assert.equal(O.arredondar(76.2, 5), 80);
  assert.equal(O.arredondar(80, 5), 80);
  assert.equal(O.arredondar(80.01, 5), 85);
  assert.equal(O.arredondar(0, 5), 0);
});

teste("o R$/h devolvido é o real, já descontado o custo e o tempo morto", () => {
  const o = O.orcar({ km: 20, minutos: 40, kmAteCliente: 5, config, alvoHora: 40 });
  const esperado = ((o.preco - o.custo) / o.minutosTotal) * 60;
  assert.ok(perto(o.reaisPorHora, esperado));
  // E tem que ser menor que o preço dividido só pelo tempo da viagem, que é a
  // conta otimista que o motorista faz de cabeça.
  assert.ok(o.reaisPorHora < (o.preco / 40) * 60, "a conta de cabeça sempre parece melhor");
});

teste("lucro é preço menos custo, e é positivo num orçamento são", () => {
  const o = O.orcar({ km: 20, minutos: 40, config, alvoHora: 40 });
  assert.ok(perto(o.lucro, o.preco - o.custo));
  assert.ok(o.lucro > 0);
});

teste("entrada incompleta não vira preço inventado", () => {
  assert.equal(O.orcar({ km: 0, minutos: 40, config, alvoHora: 40 }), null);
  assert.equal(O.orcar({ km: 20, minutos: 0, config, alvoHora: 40 }), null);
  assert.equal(O.orcar({ config, alvoHora: 40 }), null);
});

teste("alvo por hora zero ainda cobre o custo, pela conta de custo", () => {
  const o = O.orcar({ km: 20, minutos: 40, config, alvoHora: 0 });
  assert.ok(o.preco > o.custo, "nunca orçar abaixo do custo de rodar");
  assert.equal(o.manda, "custo");
});

teste("alvo sugerido sai do ideal da faixa, não da mediana", () => {
  const meiaTarde = new Date(2026, 8, 25, 14, 0, 0).getTime();
  const ref = { tarde: { hora: { piso: 30, ideal: 44, otimo: 60 } } };
  assert.equal(O.alvoSugerido(ref, meiaTarde), 44);
});

teste("sem histórico o alvo é nulo, e a tela pede o número", () => {
  assert.equal(O.alvoSugerido({}, Date.now()), null);
  assert.equal(O.alvoSugerido(null, Date.now()), null);
});

console.log(`✓ ${passou} testes passaram`);
