// Testes do cerebro do app. Roda com: node copiloto/test/metrics.test.mjs
import assert from "node:assert/strict";
import * as M from "../js/metrics.js";
import { CONFIG_PADRAO, custoEnergiaKm, custoTotalKm } from "../js/config.js";

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
const perto = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

// Uma jornada de referencia: comeca as 14h, odometro 100000.
const t0 = new Date(2026, 7, 25, 14, 0, 0).getTime();
const jornada = { id: "j1", horaInicio: t0, horaFim: null, odometroInicio: 100000, gpsInicio: 0 };

/* ------------------------------------------------------------- periodos */

teste("periodoDe cobre as cinco faixas", () => {
  const em = (h) => M.periodoDe(new Date(2026, 7, 25, h, 30).getTime());
  assert.equal(em(8), "manha");
  assert.equal(em(14), "tarde");
  assert.equal(em(19), "noite");
  assert.equal(em(23), "pico");
  assert.equal(em(0), "pico", "meia-noite ainda é pico");
  assert.equal(em(3), "madrugada");
});

teste("periodoDe respeita as bordas", () => {
  const em = (h) => M.periodoDe(new Date(2026, 7, 25, h, 0).getTime());
  assert.equal(em(6), "manha");
  assert.equal(em(12), "tarde");
  assert.equal(em(18), "noite");
  assert.equal(em(22), "pico");
  assert.equal(em(2), "madrugada");
});

/* ------------------------------------------------- checkpoint parcial */

teste("checkpoint parcial mantém o último valor de cada plataforma", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 80 } },
    { id: "b", timestamp: t0 + 2 * H, saldos: { "99": 42 } },
    { id: "c", timestamp: t0 + 3 * H, saldos: { uber: 187.4 } },
  ];
  const fontes = M.saldoPorFonte(registros);
  assert.equal(fontes.uber.valor, 187.4, "uber usa o valor mais recente");
  assert.equal(fontes["99"].valor, 42, "99 mantém o valor antigo, ainda válido");
  assert.equal(fontes.indrive.valor, 0);
  assert.ok(perto(M.saldoTotal(registros), 229.4));
});

teste("avulso soma em vez de substituir", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, avulso: { valor: 80, tipo: "frete" } },
    { id: "c", timestamp: t0 + 3 * H, avulso: { valor: 50, tipo: "particular" } },
  ];
  assert.equal(M.saldoPorFonte(registros).avulso.valor, 130);
  assert.equal(M.saldoTotal(registros), 230);
});

teste("registro desfeito não entra na conta", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, saldos: { uber: 999 }, desfeito: true },
  ];
  assert.equal(M.saldoTotal(registros), 100);
});

teste("registros fora de ordem são ordenados antes de somar", () => {
  const registros = [
    { id: "b", timestamp: t0 + 3 * H, saldos: { uber: 187 } },
    { id: "a", timestamp: t0 + H, saldos: { uber: 80 } },
  ];
  assert.equal(M.saldoTotal(registros), 187);
});

/* ----------------------------------------------------------- tempo/pausa */

teste("tempo ativo desconta pausas fechadas e a pausa em curso", () => {
  const pausas = [
    { horaInicio: t0 + H, horaFim: t0 + H + 30 * M.MINUTO },
    { horaInicio: t0 + 3 * H, horaFim: null },
  ];
  const agora = t0 + 4 * H;
  assert.equal(M.msRua(jornada, agora), 4 * H);
  assert.equal(M.msPausado(pausas, agora), 90 * M.MINUTO);
  assert.equal(M.msAtivo(jornada, pausas, agora), 4 * H - 90 * M.MINUTO);
});

teste("msPausadoEntre recorta a sobreposição com o trecho", () => {
  const pausas = [{ horaInicio: t0 + 30 * M.MINUTO, horaFim: t0 + 90 * M.MINUTO }];
  // trecho de t0+1h a t0+2h pega só os 30 min finais da pausa
  assert.equal(M.msPausadoEntre(pausas, t0 + H, t0 + 2 * H), 30 * M.MINUTO);
});

/* --------------------------------------------------------------------- km */

teste("sem GPS, o km só avança com odômetro digitado", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 80 }, odometro: 100042 }];
  assert.equal(M.kmPercorrido(jornada, registros, null), 42);
});

teste("GPS soma a partir da última âncora de odômetro", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 80 }, odometro: 100042, gpsAcum: 40 },
  ];
  // GPS marcou 40 km na ancora e 55 agora: 42 confirmados + 15 desde entao
  assert.equal(M.kmPercorrido(jornada, registros, 55), 57);
});

teste("odômetro final fecha o km e ignora o GPS", () => {
  const fechada = { ...jornada, odometroFim: 100200, horaFim: t0 + 10 * H };
  assert.equal(M.kmPercorrido(fechada, [], 999), 200);
});

teste("fator de correção do GPS mede o escorregamento", () => {
  const fechada = { ...jornada, odometroFim: 100200, gpsInicio: 0, gpsFim: 194 };
  assert.ok(perto(M.fatorCorrecaoGps(fechada), 200 / 194, 0.001));
  assert.equal(M.fatorCorrecaoGps(jornada), null, "jornada aberta não tem fator");
});

/* -------------------------------------------------------------- metricas */

teste("denominador pequeno demais devolve null em vez de número absurdo", () => {
  assert.equal(M.reaisPorHora(10, 2 * M.MINUTO), null);
  assert.equal(M.reaisPorKm(10, 0.4), null);
  assert.ok(perto(M.reaisPorHora(40, H), 40));
  assert.ok(perto(M.reaisPorKm(35, 20), 1.75));
});

teste("nivel classifica contra a faixa", () => {
  const faixa = { piso: 1.55, ideal: 1.8, otimo: 2.15 };
  assert.equal(M.nivel(1.2, faixa), "abaixo");
  assert.equal(M.nivel(1.55, faixa), "piso");
  assert.equal(M.nivel(1.9, faixa), "ideal");
  assert.equal(M.nivel(2.5, faixa), "otimo");
  assert.equal(M.nivel(null, faixa), null);
});

teste("o dia típico do motorista cai onde esperamos no semáforo", () => {
  // 10h de rua, 1h de pausa, 200 km, R$350 brutos.
  const inicioManha = new Date(2026, 7, 25, 8, 0).getTime();
  const j = { horaInicio: inicioManha, odometroInicio: 100000, gpsInicio: 0 };
  const registros = [
    { id: "a", timestamp: inicioManha + 10 * H, saldos: { uber: 350 }, odometro: 100200 },
  ];
  const pausas = [{ horaInicio: inicioManha + 5 * H, horaFim: inicioManha + 6 * H }];
  const m = M.metricasAoVivo({
    jornada: j,
    registros,
    pausas,
    gpsAcum: null,
    config: CONFIG_PADRAO,
    agora: inicioManha + 10 * H,
  });
  assert.equal(m.saldo, 350);
  assert.equal(m.km, 200);
  assert.ok(perto(m.reaisPorKm, 1.75), `R$/km foi ${m.reaisPorKm}`);
  assert.ok(perto(m.reaisPorHora, 350 / 9, 0.01), `R$/h foi ${m.reaisPorHora}`);
  // 38,9 R$/h contra faixa 32/40/50 -> zona "piso" (entre piso e ideal)
  assert.equal(m.nivelHora, "piso");
  // 1,75 R$/km as 18h (faixa noite 1,70/2,00/2,40) -> tambem "piso".
  // O ponto: NAO é "abaixo". Com a tabela generica de mercado seria.
  assert.equal(m.nivelKm, "piso");
});

/* ---------------------------------------------------------------- trecho */

teste("ultimoTrecho mede o desempenho entre os dois últimos checkpoints", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 40 }, odometro: 100030, gpsAcum: 30 },
    { id: "b", timestamp: t0 + 2 * H, saldos: { uber: 80 }, odometro: 100055, gpsAcum: 55 },
  ];
  const trecho = M.ultimoTrecho(jornada, registros, []);
  assert.equal(trecho.delta, 40);
  assert.equal(trecho.msAtivo, H);
  assert.equal(trecho.km, 25);
  assert.ok(perto(trecho.reaisPorHora, 40));
  assert.ok(perto(trecho.reaisPorKm, 1.6));
  assert.equal(trecho.confiavel, true);
});

teste("primeiro trecho do dia parte da abertura da jornada", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 40 } }];
  const trecho = M.ultimoTrecho(jornada, registros, []);
  assert.equal(trecho.delta, 40);
  assert.equal(trecho.msAtivo, H);
});

teste("trecho curto é marcado como não confiável", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 40 } },
    { id: "b", timestamp: t0 + H + 3 * M.MINUTO, saldos: { uber: 55 } },
  ];
  assert.equal(M.ultimoTrecho(jornada, registros, []).confiavel, false);
});

teste("trecho com pausa no meio desconta a pausa", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 40 } },
    { id: "b", timestamp: t0 + 3 * H, saldos: { uber: 80 } },
  ];
  const pausas = [{ horaInicio: t0 + 90 * M.MINUTO, horaFim: t0 + 150 * M.MINUTO }];
  const trecho = M.ultimoTrecho(jornada, registros, pausas);
  assert.equal(trecho.msAtivo, H, "2h de trecho menos 1h de pausa");
  assert.ok(perto(trecho.reaisPorHora, 40));
});

teste("delta negativo é preservado (estorno/cancelamento)", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, saldos: { uber: 88 } },
  ];
  assert.equal(M.ultimoTrecho(jornada, registros, []).delta, -12);
});

/* ----------------------------------------------------------------- metas */

teste("proximoPatamar aponta o próximo alvo", () => {
  assert.equal(M.proximoPatamar(100, CONFIG_PADRAO).id, "minima");
  assert.equal(M.proximoPatamar(300, CONFIG_PADRAO).id, "ideal");
  assert.equal(M.proximoPatamar(400, CONFIG_PADRAO).id, "otima");
  assert.equal(M.proximoPatamar(500, CONFIG_PADRAO), null);
  assert.equal(M.patamaresAtingidos(360, CONFIG_PADRAO).length, 2);
});

teste("projeção estima quando a meta cai", () => {
  // R$175 em 5h ativas = 35 R$/h. Faltam 175 para os 350 -> mais 5h.
  const p = M.projecao(175, 5 * H, 350, t0);
  assert.ok(perto(p.faltamMs, 5 * H, 1000));
  assert.equal(p.jaAtingido, false);
  assert.equal(M.projecao(400, 5 * H, 350, t0).jaAtingido, true);
  assert.equal(M.projecao(0, 5 * H, 350, t0), null, "sem ritmo, sem projeção");
});

/* -------------------------------------------------------------- dinheiro */

teste("custo por km bate com GNV a 4,30 e 10 km/m3", () => {
  assert.ok(perto(custoEnergiaKm(CONFIG_PADRAO), 0.437, 0.002), custoEnergiaKm(CONFIG_PADRAO));
  assert.ok(perto(custoTotalKm(CONFIG_PADRAO), 0.687, 0.002));
});

teste("líquido do dia típico", () => {
  const liquido = M.liquidoEstimado(350, 200, CONFIG_PADRAO);
  // 350 - (0,437 + 0,25) * 200 = ~212
  assert.ok(perto(liquido, 212.6, 1), `líquido foi ${liquido}`);
});

/* -------------------------------------------------------------- corridas */

const corrida = (h, valor, km, extra = {}) => ({
  id: `c${h}`,
  timestamp: new Date(2026, 7, 25, h, 0).getTime(),
  plataforma: "uber",
  valorBruto: valor,
  valorDinamico: 0,
  km,
  duracaoMin: 10,
  bairroOrigem: "Luz",
  bairroDestino: "Centro NI",
  ...extra,
});

teste("checkpoints mandam quando existem; corridas só quando não há checkpoint", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 309 } }];
  const corridas = [corrida(20, 100, 10), corrida(21, 90, 12)];
  // Com checkpoint, o total da plataforma é a verdade — somar os dois contaria
  // o mesmo dinheiro duas vezes.
  assert.equal(M.brutoDoDia(registros, corridas), 309);
  assert.equal(M.brutoDoDia([], corridas), 190);
  assert.equal(M.brutoDoDia([], []), 0);
});

teste("conferência acusa corrida faltando no lançamento", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 300 } }];
  assert.equal(M.conferenciaCorridas(registros, [corrida(20, 290, 10)]).fecha, true, "10 de folga passa");
  const falta = M.conferenciaCorridas(registros, [corrida(20, 200, 10)]);
  assert.equal(falta.fecha, false);
  assert.equal(falta.diferenca, 100);
  assert.equal(M.conferenciaCorridas([], [corrida(20, 200, 10)]), null, "sem checkpoint não há o que conferir");
});

teste("R$/km real inclui o deslocamento até o passageiro", () => {
  // R$20 numa corrida de 4 km parece 5,00/km — mas foram 3 km só para chegar.
  const c = corrida(20, 20, 4, { kmDeslocamento: 3 });
  assert.ok(perto(20 / 4, 5.0));
  assert.ok(perto(M.reaisPorKmReal(c), 20 / 7), "deve considerar 7 km, não 4");
  assert.equal(M.reaisPorKmReal(corrida(20, 20, 0, { kmDeslocamento: 0 })), null);
});

teste("aproveitamento de km compara km pago com km de odômetro", () => {
  const cs = [corrida(20, 100, 30), corrida(21, 80, 40)];
  const a = M.aproveitamentoKm(cs, 200);
  assert.equal(a.kmPago, 70);
  assert.ok(perto(a.fracao, 0.35));
  assert.equal(M.aproveitamentoKm(cs, 0).fracao, null);
});

teste("bairros usados saem por frequência, sem vazios nem '?'", () => {
  const cs = [
    corrida(20, 10, 2),
    corrida(21, 10, 2, { bairroOrigem: "Luz", bairroDestino: "Queimados" }),
    corrida(22, 10, 2, { bairroOrigem: "?", bairroDestino: "" }),
  ];
  const lista = M.bairrosUsados(cs);
  assert.equal(lista[0], "Luz", "Luz aparece 2x, vem primeiro");
  assert.ok(lista.includes("Queimados"));
  assert.ok(!lista.includes("?") && !lista.includes(""));
});

/* ----------------------------------------------------------- formatacao */

teste("formatação", () => {
  assert.equal(M.formatarReais(1234.5), "1.234,50");
  assert.equal(M.formatarReais(350, { comCentavos: false }), "350");
  assert.equal(M.formatarReais(null), "—");
  assert.equal(M.formatarDuracao(3 * H + 25 * M.MINUTO), "3:25");
  assert.equal(M.formatarDuracao(0), "0:00");
  assert.equal(M.chaveData(new Date(2026, 0, 5, 3, 0).getTime()), "2026-01-05");
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
