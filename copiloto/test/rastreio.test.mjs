// Testes do rastreio por GPS. node copiloto/test/rastreio.test.mjs
//
// O módulo só liga no app nativo, mas a decisão de aceitar ou descartar cada
// ponto é pura -- e é onde o erro dói. Aqui ela é exercitada sem aparelho.
import assert from "node:assert/strict";
import * as R from "../js/rastreio.js";

let passou = 0;
function teste(nome, fn) {
  try {
    R.zerarParaTeste();
    fn();
    passou++;
  } catch (erro) {
    console.error(`✗ ${nome}\n  ${erro.message}`);
    process.exitCode = 1;
  }
}

const T0 = new Date(2026, 8, 20, 14, 0, 0).getTime();

/** Um grau de latitude ≈ 111,19 km, então isto move ~metros para o norte. */
const metrosAoNorte = (m) => m / 111194.9;

const ponto = (metros, segundos, accuracy = 10) => ({
  latitude: -19.9 + metrosAoNorte(metros),
  longitude: -43.9,
  accuracy,
  time: T0 + segundos * 1000,
});

const perto = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

teste("primeiro ponto só ancora, não soma", () => {
  R.receber(ponto(0, 0));
  assert.equal(R.kmAcumulado(), 0);
});

teste("deslocamento real soma", () => {
  R.receber(ponto(0, 0));
  R.receber(ponto(1000, 60));
  assert.ok(perto(R.kmAcumulado(), 1), `esperava ~1 km, veio ${R.kmAcumulado()}`);
});

teste("tremulação parado não acumula km", () => {
  R.receber(ponto(0, 0));
  // 200 leituras tremulando poucos metros, como num semáforo longo.
  for (let i = 1; i <= 200; i++) R.receber(ponto(i % 2 ? 5 : 0, i));
  assert.equal(R.kmAcumulado(), 0, "GPS parado não pode gerar quilometragem");
});

teste("ponto impreciso é ignorado", () => {
  R.receber(ponto(0, 0));
  R.receber(ponto(2000, 60, 300));
  assert.equal(R.kmAcumulado(), 0);
});

teste("salto de sinal não vira dezenas de km", () => {
  R.receber(ponto(0, 0));
  // 30 km em 2 segundos: impossível.
  R.receber(ponto(30000, 2));
  assert.equal(R.kmAcumulado(), 0);
});

teste("depois do salto a referência é o ponto novo, não o abandonado", () => {
  R.receber(ponto(0, 0));
  R.receber(ponto(30000, 2)); // descartado
  R.receber(ponto(31000, 120)); // 1 km a partir do ponto novo
  assert.ok(perto(R.kmAcumulado(), 1), `esperava ~1 km, veio ${R.kmAcumulado()}`);
});

teste("dois pontos no mesmo instante não dão velocidade infinita", () => {
  R.receber(ponto(0, 0));
  R.receber(ponto(20, 0));
  assert.ok(R.kmAcumulado() >= 0, "não pode explodir nem ficar NaN");
  assert.ok(Number.isFinite(R.kmAcumulado()));
});

teste("coordenada inválida é ignorada", () => {
  R.receber({ latitude: NaN, longitude: -43.9, time: T0 });
  R.receber({ latitude: -19.9, longitude: undefined, time: T0 });
  assert.equal(R.kmAcumulado(), 0);
});

teste("sem precisão declarada o ponto ainda vale", () => {
  R.receber({ latitude: -19.9, longitude: -43.9, time: T0 });
  R.receber({ latitude: -19.9 + metrosAoNorte(1000), longitude: -43.9, time: T0 + 60000 });
  assert.ok(perto(R.kmAcumulado(), 1));
});

teste("uma hora de cidade acumula distância plausível", () => {
  R.receber(ponto(0, 0));
  // ~30 km/h médios: 500 m a cada minuto, por 60 minutos.
  for (let i = 1; i <= 60; i++) R.receber(ponto(i * 500, i * 60));
  assert.ok(perto(R.kmAcumulado(), 30, 0.5), `esperava ~30 km, veio ${R.kmAcumulado()}`);
});

teste("na web o rastreio não está disponível", () => {
  assert.equal(R.disponivel(), false, "sem Capacitor não existe rastreio");
  assert.equal(R.estaRastreando(), false);
});

console.log(`✓ ${passou} testes passaram`);
