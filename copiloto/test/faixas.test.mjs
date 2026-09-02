// Testes das faixas medidas. node copiloto/test/faixas.test.mjs
import assert from "node:assert/strict";
import * as F from "../js/faixas.js";
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

// 2026-08-31, segunda. 14h é tarde; 20h é noite.
const em = (hora, minuto = 0) => new Date(2026, 7, 31, hora, minuto).getTime();

function jornadaCom(checkpoints, { horaInicio = em(14), odometroInicio = 100000 } = {}) {
  const jornada = { id: "j1", data: "2026-08-31", horaInicio, horaFim: null, odometroInicio, odometroFim: null, saldoInicial: {} };
  const registros = checkpoints.map((c, i) => ({
    id: `r${i}`,
    jornadaId: "j1",
    timestamp: c.quando,
    saldos: { uber: c.saldo },
    odometro: c.odometro ?? null,
    tipo: "checkpoint",
    desfeito: false,
  }));
  return { jornada, registros };
}

/* --------------------------------------------------------------- trechos */

teste("cada checkpoint fecha um trecho com valor e duração", () => {
  const { jornada, registros } = jornadaCom([
    { quando: em(16), saldo: 60 },
    { quando: em(18), saldo: 150 },
  ]);
  const t = F.trechosDe([jornada], registros);
  assert.equal(t.length, 2);
  assert.equal(t[0].valor, 60);
  assert.ok(perto(t[0].reaisPorHora, 30), "60 em 2h");
  assert.equal(t[1].valor, 90);
  assert.ok(perto(t[1].reaisPorHora, 45));
  assert.equal(t[0].periodo, "tarde");
});

teste("km do trecho só existe com odômetro nas DUAS pontas", () => {
  const { jornada, registros } = jornadaCom([
    { quando: em(16), saldo: 60, odometro: 100040 }, // abertura tem odômetro: 40 km
    { quando: em(18), saldo: 150 },                  // sem odômetro: trecho sem km
    { quando: em(20), saldo: 260, odometro: 100120 },
  ]);
  const t = F.trechosDe([jornada], registros);
  assert.ok(perto(t[0].reaisPorKm, 1.5), "60 em 40 km");
  assert.equal(t[1].km, null);
  assert.equal(t[2].km, null, "herdar a âncora antiga faria o km do trecho anterior vazar para este");
});

teste("dia importado da planilha não vira trecho", () => {
  const { jornada, registros } = jornadaCom([{ quando: em(16), saldo: 60 }]);
  jornada.origem = "planilha";
  assert.deepEqual(F.trechosDe([jornada], registros), []);
});

teste("trecho sem ganho não entra na amostra", () => {
  const { jornada, registros } = jornadaCom([
    { quando: em(16), saldo: 0 },
    { quando: em(18), saldo: 90 },
  ]);
  const t = F.trechosDe([jornada], registros);
  assert.equal(t.length, 1, "duas horas paradas não descrevem faixa nenhuma");
  assert.equal(t[0].valor, 90);
});

/* ------------------------------------------------------------- percentis */

teste("percentil interpola e devolve null para lista vazia", () => {
  assert.equal(F.percentil([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(F.percentil([10, 20], 0.5), 15);
  assert.equal(F.percentil([], 0.5), null);
  assert.equal(F.percentil([5], 0.8), 5);
});

teste("amostra curta não vira faixa", () => {
  assert.equal(F.faixaDe([1, 2, 3], { minimo: 8 }), null, "três trechos não descrevem um período");
});

teste("faixa sai em ordem e nunca abaixo do chão econômico", () => {
  const amostra = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1];
  const semChao = F.faixaDe(amostra, { minimo: 8 });
  assert.ok(semChao.piso < semChao.ideal && semChao.ideal < semChao.otimo);
  assert.equal(semChao.n, 10);
  assert.equal(semChao.medida, true);

  // Um piso abaixo do custo por km não é piso: ali ele paga para trabalhar.
  const comChao = F.faixaDe(amostra, { minimo: 8, chao: 0.69 });
  assert.equal(comChao.piso, 0.69);
  assert.ok(comChao.ideal >= comChao.piso);
  assert.ok(comChao.otimo >= comChao.ideal);
});

/* -------------------------------------------------- faixas de jornada */

teste("período sem amostra fica com a semente dos Ajustes", () => {
  const semente = {
    faixasKm: { tarde: { piso: 1.55, ideal: 1.8, otimo: 2.15 }, noite: { piso: 1.7, ideal: 2, otimo: 2.4 } },
    faixasHora: { tarde: { piso: 32, ideal: 40, otimo: 50 }, noite: { piso: 32, ideal: 40, otimo: 50 } },
  };
  const f = F.faixasDeJornada([], semente);
  assert.equal(f.tarde.km.piso, 1.55);
  assert.equal(f.tarde.km.medida, false);
  assert.equal(f.tarde.hora.ideal, 40);
  assert.equal(f.tarde.km.n, 0);
});

teste("com amostra, a faixa medida substitui a semente daquele período", () => {
  const base = em(14);
  const trechos = [];
  for (let i = 0; i < 10; i++) {
    trechos.push({ periodo: "tarde", reaisPorHora: 30 + i, reaisPorKm: 1 + i / 10, valor: 1, ms: 1, km: 1 });
  }
  const semente = { faixasKm: { tarde: { piso: 9, ideal: 9, otimo: 9 } }, faixasHora: { tarde: { piso: 9, ideal: 9, otimo: 9 } } };
  const f = F.faixasDeJornada(trechos, semente);

  assert.equal(f.tarde.hora.medida, true);
  assert.equal(f.tarde.hora.n, 10);
  assert.ok(f.tarde.hora.piso > 30 && f.tarde.hora.otimo < 40);
  assert.equal(f.noite.km.medida, false, "outro período não herda a medição da tarde");
});

/* ------------------------------------------------ referência de aceite */

teste("a referência de aceite usa a escala da CORRIDA, não a da jornada", () => {
  // Vinte corridas de R$20 em 5 km e 15 min: 4 R$/km e 80 R$/h. Numa jornada
  // com dead km, esse mesmo dinheiro daria perto de 2 R$/km — misturar as
  // duas escalas foi a confusão que este projeto já pagou caro.
  const corridas = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    timestamp: em(20, i),
    valorBruto: 20,
    km: 5,
    duracaoMin: 15,
  }));
  const r = F.referenciaDeAceite(corridas);
  assert.equal(r.noite.n, 20);
  assert.ok(perto(r.noite.km.ideal, 4));
  assert.ok(perto(r.noite.hora.ideal, 80));
  assert.equal(r.tarde.km, null, "período sem corrida não inventa referência");
});

teste("corrida sem km ou sem duração não contamina a referência", () => {
  const corridas = Array.from({ length: 15 }, (_, i) => ({
    id: `c${i}`,
    timestamp: em(20, i),
    valorBruto: 20,
    km: i < 12 ? 5 : 0,
    duracaoMin: 0,
  }));
  const r = F.referenciaDeAceite(corridas);
  assert.ok(r.noite.km, "doze corridas com km bastam");
  assert.equal(r.noite.hora, null, "nenhuma tem duração");
});

teste("período agora tem nome para a tela mostrar", () => {
  assert.equal(F.periodoAgora(em(20)).id, "noite");
  assert.equal(F.periodoAgora(em(20)).nome, "Noite");
});

/* --------------------------------------------------------- piso de aceite */

const fecha = { fecha: true };
teste("aproveitamento só conta jornada com km E corridas", () => {
  const resumos = [
    { km: 200, corridas: [{ valorBruto: 10, km: 60 }, { valorBruto: 10, km: 50 }], conferencia: fecha },
    { km: 0, corridas: [{ valorBruto: 10, km: 40 }], conferencia: fecha }, // sem odômetro
    { km: 150, corridas: [], conferencia: fecha },                          // sem corridas lançadas
  ];
  const a = F.aproveitamentoDe(resumos);
  assert.ok(perto(a.fracao, 110 / 200), "só a primeira jornada tem os dois lados da conta");
  assert.equal(F.aproveitamentoDe([]), null);
  assert.equal(F.aproveitamentoDe([{ km: 0, corridas: [], conferencia: fecha }]), null);
});

teste("jornada com corridas pela metade fica de fora do aproveitamento", () => {
  // Este é o erro que fez o app mandar recusar corrida boa. Metade das
  // corridas lançadas derruba o numerador pela metade, o aproveitamento cai
  // pela metade e o piso por km DOBRA — passando por cima da mediana.
  const completa = { km: 200, corridas: [{ valorBruto: 100, km: 110 }], conferencia: { fecha: true } };
  const pelaMetade = { km: 200, corridas: [{ valorBruto: 100, km: 55 }], conferencia: { fecha: false } };

  assert.ok(perto(F.aproveitamentoDe([completa]).fracao, 0.55));
  assert.equal(F.aproveitamentoDe([pelaMetade]), null, "sem conferir, não entra");
  assert.ok(perto(F.aproveitamentoDe([completa, pelaMetade]).fracao, 0.55), "a incompleta não contamina a completa");
});

teste("o piso por km divide o custo pelo aproveitamento", () => {
  // O custo por km é gasto em TODO km rodado, e só 55% deles têm passageiro
  // pagando. Empatar com o carro exige R$0,69 / 0,55 por km de corrida.
  const p = F.pisoDeAceite({ custoKm: 0.69, aproveitamento: 0.55, faixaDaJornada: null });
  assert.ok(perto(p.km, 1.2545));
  assert.equal(p.hora, null);
});

teste("o piso por hora é o ritmo da JORNADA, nunca a mediana das corridas", () => {
  // A mediana das corridas deixa metade delas abaixo por definição: usá-la
  // como corte seria mandar recusar metade do trabalho.
  const faixaDaJornada = { hora: { piso: 39, ideal: 43, otimo: 48 }, km: { piso: 1.8, ideal: 1.9, otimo: 2 } };
  const p = F.pisoDeAceite({ custoKm: 0.69, aproveitamento: 0.55, faixaDaJornada });
  assert.equal(p.hora, 39, "o corte é o piso do ritmo de jornada");
  assert.equal(p.ritmoHora, 43);
  assert.ok(p.hora < 67, "uma corrida de 67 R$/h numa madrugada tem que passar, não ser recusada");
});

teste("sem aproveitamento medido não se inventa piso por km", () => {
  const p = F.pisoDeAceite({ custoKm: 0.69, aproveitamento: null, faixaDaJornada: null });
  assert.equal(p.km, null, "sem odômetro não dá para saber quanto do rodado tem passageiro");
  assert.equal(F.pisoDeAceite({ custoKm: 0.69, aproveitamento: 1.4 }).km, null, "fração acima de 1 é dado sujo");
});

teste("o piso fica bem abaixo da mediana das corridas — é isso que ele tem que ser", () => {
  const corridas = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`, timestamp: em(20, i), valorBruto: 20, km: 5, duracaoMin: 15,
  }));
  const mediana = F.referenciaDeAceite(corridas).noite;
  const piso = F.pisoDeAceite({
    custoKm: 0.69,
    aproveitamento: 0.55,
    faixaDaJornada: { hora: { piso: 39, ideal: 43, otimo: 48 } },
  });
  assert.ok(piso.km < mediana.km.ideal, `piso ${piso.km} tem que ficar abaixo da mediana ${mediana.km.ideal}`);
  assert.ok(piso.hora < mediana.hora.ideal, "idem para a hora");
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
