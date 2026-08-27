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

teste("km só avança com odômetro digitado", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 80 }, odometro: 100042 }];
  assert.equal(M.kmPercorrido(jornada, registros), 42);
  assert.equal(M.kmPercorrido(jornada, []), 0, "sem âncora, sem km — nunca um número inventado");
});

teste("odômetro final fecha o km do dia", () => {
  const fechada = { ...jornada, odometroFim: 100200, horaFim: t0 + 10 * H };
  assert.equal(M.kmPercorrido(fechada, []), 200);
});

teste("kmAte recorta o km até um instante", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: {}, odometro: 100030 },
    { id: "b", timestamp: t0 + 2 * H, saldos: {}, odometro: 100055 },
  ];
  assert.equal(M.kmAte(jornada, registros, t0 + H), 30);
  assert.equal(M.kmAte(jornada, registros, t0 + 2 * H), 55);
  assert.equal(M.ancorasOdometro(registros), 2);
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
    eventos: M.eventosDoDia([j], registros),
    registros,
    pausas,
    config: CONFIG_PADRAO,
    agora: inicioManha + 10 * H,
  });
  assert.equal(m.saldo, 350);
  assert.equal(m.ganho, 350);
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

/* --------------------------------------------- linha de base da jornada */

// A abertura de jornada declara onde o dia estava. `eventosDoDia` transforma
// essa declaração num evento da linha do tempo, junto com os registros.
const comBase = (jornadaBase, registros) => M.eventosDoDia([jornadaBase], registros);

teste("segunda jornada do dia: registrar o total NÃO soma com o turno anterior", () => {
  // O caso relatado: turno da tarde terminou em R$100, o motorista abre outra
  // jornada informando 100, faz uma corrida de R$10 e digita 110 (o total que
  // a plataforma mostra). O dia tem que ficar em 110 — nunca 210.
  const tarde = { id: "j1", horaInicio: t0, saldoInicial: {} };
  const noite = { id: "j2", horaInicio: t0 + 4 * H, saldoInicial: { uber: 100 } };
  const registros = [
    { id: "a", jornadaId: "j1", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", jornadaId: "j2", timestamp: t0 + 5 * H, saldos: { uber: 110 } },
  ];
  const eventos = M.eventosDoDia([tarde, noite], registros);

  assert.equal(M.saldoEm(eventos, t0 + 5 * H), 110, "o saldo do dia é o último valor lido");
  assert.equal(M.ganhoDaJornada(eventos, noite, t0 + 5 * H), 10, "a noite rendeu 10");
  assert.equal(M.ganhoDaJornada(eventos, tarde, t0 + 4 * H), 100, "a tarde rendeu 100");
});

teste("declaração de abertura não infla o dia quando repete o que já foi lido", () => {
  // A declaração diz "o dia estava em 100" e o registro anterior já dizia 100.
  // Substituir, não somar: continua 100.
  const tarde = { id: "j1", horaInicio: t0, saldoInicial: {} };
  const noite = { id: "j2", horaInicio: t0 + 4 * H, saldoInicial: { uber: 100 } };
  const eventos = M.eventosDoDia([tarde, noite], [
    { id: "a", jornadaId: "j1", timestamp: t0 + H, saldos: { uber: 100 } },
  ]);
  assert.equal(M.saldoEm(eventos, t0 + 4 * H), 100);
  assert.equal(M.ganhoDaJornada(eventos, noite, t0 + 4 * H), 0);
});

teste("abertura sem jornada anterior semeia o dia", () => {
  // Instalou o app no meio do dia com R$100 já feitos: a declaração é a única
  // notícia que o app tem desse dinheiro.
  const j = { id: "j1", horaInicio: t0, saldoInicial: { uber: 100 } };
  const eventos = M.eventosDoDia([j], [{ id: "a", timestamp: t0 + H, saldos: { uber: 160 } }]);
  assert.equal(M.saldoEm(eventos, t0 + H), 160);
  assert.equal(M.ganhoDaJornada(eventos, j, t0 + H), 60);
});

teste("três jornadas no mesmo dia continuam sem duplicar", () => {
  const js = [
    { id: "j1", horaInicio: t0, saldoInicial: {} },
    { id: "j2", horaInicio: t0 + 3 * H, saldoInicial: { uber: 100 } },
    { id: "j3", horaInicio: t0 + 6 * H, saldoInicial: { uber: 150 } },
  ];
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 4 * H, saldos: { uber: 150 } },
    { id: "c", timestamp: t0 + 7 * H, saldos: { uber: 220 } },
  ];
  const eventos = M.eventosDoDia(js, registros);
  assert.equal(M.saldoEm(eventos, t0 + 7 * H), 220, "o dia é o último valor, não a soma dos pedaços");
  assert.equal(M.ganhoDaJornada(eventos, js[2], t0 + 7 * H), 70);
  assert.equal(M.ganhoDaJornada(eventos, js[1], t0 + 6 * H), 50);
});

teste("avulso soma; plataforma substitui", () => {
  const j = { id: "j1", horaInicio: t0, saldoInicial: {} };
  const eventos = M.eventosDoDia([j], [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, avulso: { valor: 80, tipo: "frete" } },
    { id: "c", timestamp: t0 + 3 * H, saldos: { uber: 130 } },
    { id: "d", timestamp: t0 + 4 * H, avulso: { valor: 50, tipo: "particular" } },
  ]);
  assert.equal(M.saldoEm(eventos, t0 + 4 * H), 130 + 130, "130 de Uber + 130 de avulsos");
});

teste("avulso de uma jornada não vaza para o ganho da seguinte", () => {
  const js = [
    { id: "j1", horaInicio: t0, saldoInicial: {} },
    { id: "j2", horaInicio: t0 + 3 * H, saldoInicial: { uber: 100 } },
  ];
  const eventos = M.eventosDoDia(js, [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, avulso: { valor: 80 } },
    { id: "c", timestamp: t0 + 4 * H, saldos: { uber: 110 } },
  ]);
  assert.equal(M.saldoEm(eventos, t0 + 4 * H), 190);
  assert.equal(M.ganhoDaJornada(eventos, js[1], t0 + 4 * H), 10, "só os 10 da corrida da noite");
});

teste("registro desfeito sai da linha do tempo", () => {
  const j = { id: "j1", horaInicio: t0, saldoInicial: {} };
  const eventos = M.eventosDoDia([j], [
    { id: "a", timestamp: t0 + H, saldos: { uber: 100 } },
    { id: "b", timestamp: t0 + 2 * H, saldos: { uber: 999 }, desfeito: true },
  ]);
  assert.equal(M.saldoEm(eventos, t0 + 3 * H), 100);
});

teste("a janela de uma jornada exclui a abertura da seguinte", () => {
  // A jornada da tarde fechou marcando 90. A da noite abre declarando 100 —
  // possivelmente horas depois. Esses 10 não são rendimento da tarde.
  const tarde = { id: "j1", data: "d", horaInicio: t0, horaFim: t0 + 2 * H, saldoInicial: {} };
  const noite = { id: "j2", data: "d", horaInicio: t0 + 5 * H, saldoInicial: { uber: 100 } };
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 90 } },
    { id: "b", timestamp: t0 + 6 * H, saldos: { uber: 130 } },
  ];

  const jTarde = M.janelaDaJornada([tarde, noite], registros, tarde);
  assert.equal(jTarde.ganho, 90, "a tarde rendeu os 90 que ela mediu");
  assert.equal(jTarde.proxima.id, "j2");
  assert.equal(jTarde.fontesFim.uber.valor, 90);

  const jNoite = M.janelaDaJornada([tarde, noite], registros, noite);
  assert.equal(jNoite.ganho, 30, "a noite rendeu de 100 a 130");

  // O dia inteiro é 130; a soma das jornadas dá 120. A diferença é o salto
  // entre turnos, que não pertence a nenhuma das duas — e isso é honesto.
  assert.equal(M.saldoEm(M.eventosDoDia([tarde, noite], registros), t0 + 6 * H), 130);
});

teste("última jornada do dia vai até o próprio fechamento", () => {
  const unica = { id: "j1", data: "d", horaInicio: t0, horaFim: t0 + 3 * H, saldoInicial: {} };
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 200 } }];
  const janela = M.janelaDaJornada([unica], registros, unica);
  assert.equal(janela.proxima, null);
  assert.equal(janela.ate, t0 + 3 * H);
  assert.equal(janela.ganho, 200);
});

/* ------------------------------------------------------------------ bloco */

const JANELA = 2 * H;

teste("bloco mede a janela recente, não o acumulado do dia", () => {
  // Começo fraco (R$20 na primeira hora) e um pedaço forte depois.
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 20 } },
    { id: "b", timestamp: t0 + 3 * H, saldos: { uber: 40 } },
    { id: "c", timestamp: t0 + 5 * H, saldos: { uber: 200 } },
  ];
  const b = M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + 5 * H });
  assert.equal(b.delta, 160, "só o que entrou na janela");
  assert.equal(b.msAtivo, 2 * H);
  assert.ok(perto(b.reaisPorHora, 80), `bloco deu ${b.reaisPorHora}`);
  // O dia inteiro daria 200/5h = 40 R$/h. O bloco mostra o dobro.
  assert.ok(perto(M.reaisPorHora(200, 5 * H), 40));
  assert.equal(b.confiavel, true);
});

teste("bloco também protege do contrário: janela pior que o dia", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 200 } },
    { id: "b", timestamp: t0 + 3 * H, saldos: { uber: 220 } },
    { id: "c", timestamp: t0 + 5 * H, saldos: { uber: 230 } },
  ];
  const b = M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + 5 * H });
  assert.ok(perto(b.reaisPorHora, 5), `bloco deu ${b.reaisPorHora}`);
  assert.ok(perto(M.reaisPorHora(230, 5 * H), 46), "o dia acumulado mostraria 46 R$/h");
  assert.ok(b.reaisPorHora < 10, "o bloco denuncia o esfriamento que a média do dia esconde");
});

teste("bloco não existe sem registro dentro da janela", () => {
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 100 } }];
  assert.equal(M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + 6 * H }), null);
  assert.equal(M.bloco({ jornada, registros: [], pausas: [], duracaoMs: JANELA, agora: t0 + H }), null);
});

teste("janela magra não vira número, vira travessão", () => {
  // Nos primeiros minutos da jornada a janela ainda não tem tempo medido
  // suficiente; um R$/h daí seria espetacular e falso.
  const registros = [{ id: "a", timestamp: t0 + 12 * M.MINUTO, saldos: { uber: 50 } }];
  const b = M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + 12 * M.MINUTO });
  assert.equal(b.confiavel, false, "12 minutos não sustentam um R$/h");
  assert.equal(b.reaisPorHora, null);
  assert.equal(b.delta, 50, "o delta continua disponível");
});

teste("no começo da jornada o bloco recua até a abertura", () => {
  // Antes de completar a janela inteira nao ha ancora anterior, entao o bloco
  // coincide com o dia — que é o certo: nao ha outro pedaço com que comparar.
  const registros = [{ id: "a", timestamp: t0 + H, saldos: { uber: 45 } }];
  const b = M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + H });
  assert.equal(b.inicio, jornada.horaInicio);
  assert.equal(b.msAtivo, H);
  assert.ok(perto(b.reaisPorHora, 45));
});

teste("bloco desconta pausa e usa a linha de base", () => {
  const inicial = { uber: 100 };
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 140 } },
    { id: "b", timestamp: t0 + 4 * H, saldos: { uber: 200 } },
  ];
  const pausas = [{ horaInicio: t0 + 2 * H, horaFim: t0 + 3 * H }];
  const b = M.bloco({ jornada, registros, pausas, saldoInicial: inicial, duracaoMs: JANELA, agora: t0 + 4 * H });
  assert.equal(b.delta, 60);
  assert.equal(b.msAtivo, 2 * H, "3h de janela menos 1h de pausa");
  assert.ok(perto(b.reaisPorHora, 30));
});

teste("bloco pega R$/km quando há âncora de odômetro dentro da janela", () => {
  const registros = [
    { id: "a", timestamp: t0 + H, saldos: { uber: 40 }, odometro: 100020 },
    { id: "b", timestamp: t0 + 3 * H, saldos: { uber: 120 }, odometro: 100060 },
  ];
  const b = M.bloco({ jornada, registros, pausas: [], duracaoMs: JANELA, agora: t0 + 3 * H });
  assert.equal(b.km, 40);
  assert.ok(perto(b.reaisPorKm, 2.0));
  // Sem âncoras o km da janela é zero e o R$/km some, em vez de mentir.
  const semOdo = M.bloco({
    jornada,
    registros: registros.map(({ odometro, ...r }) => r),
    pausas: [],
    duracaoMs: JANELA,
    agora: t0 + 3 * H,
  });
  assert.equal(semOdo.reaisPorKm, null);
});

/* -------------------------------------------------------------- projecao */

const METAS = { metaMinima: 280, metaIdeal: 350, metaOtima: 450 };
const AGORA_20H = new Date(2026, 7, 25, 20, 0).getTime();

teste("projeção estima quando a meta cai", () => {
  // Ritmo de 35 R$/h e faltam 175 para os 350 -> mais 5h.
  const p = M.projecao(175, 350, 35, t0);
  assert.ok(perto(p.faltamMs, 5 * H, 1000));
  assert.equal(p.jaAtingido, false);
  assert.equal(M.projecao(400, 350, 35, t0).jaAtingido, true);
  assert.equal(M.projecao(175, 350, 0, t0), null, "sem ritmo, sem projeção");
});

teste("o ritmo vem da jornada, o alvo vem do dia — nunca misturados", () => {
  // O defeito que projetava R$1.747: saldo do dia (185, com 178 de base) sobre
  // o tempo desta jornada (13 min) dava 854 R$/h. O ritmo é do que a jornada
  // produziu — 7 reais em 45 min.
  const p = M.projecaoDetalhada({
    saldo: 185,
    ganho: 7,
    msAtivos: 45 * M.MINUTO,
    metas: { metaMinima: 300, metaIdeal: 350, metaOtima: 450 },
    horaLimite: 23,
    agora: new Date(2026, 7, 26, 21, 4).getTime(),
  });
  assert.ok(perto(p.ritmo, 9.33, 0.05), `ritmo deu ${p.ritmo}`);
  assert.ok(p.projetado < 220, `projetou ${p.projetado} — não pode explodir`);
  assert.equal(p.tipo, "aperto");
});

teste("projeção não extrapola a noite a partir de minutos", () => {
  const curta = M.projecaoDetalhada({
    saldo: 185, ganho: 7, msAtivos: 13 * M.MINUTO, metas: METAS, horaLimite: 23, agora: AGORA_20H,
  });
  assert.equal(curta.tipo, "sem_ritmo", "13 minutos não sustentam uma projeção");
  assert.equal(curta.falta, 95, "mas o quanto falta continua sendo dito");

  const suficiente = M.projecaoDetalhada({
    saldo: 185, ganho: 30, msAtivos: 45 * M.MINUTO, metas: METAS, horaLimite: 23, agora: AGORA_20H,
  });
  assert.ok(perto(suficiente.ritmo, 40), `ritmo deu ${suficiente.ritmo}`);
  assert.ok(perto(suficiente.projetado, 305), `projetou ${suficiente.projetado}`);
  assert.equal(suficiente.tipo, "alcancavel", "305 passa da mínima de 280");
});

teste("projeção classifica alcançável e aperto", () => {
  const facil = M.projecaoDetalhada({
    saldo: 260, ganho: 200, msAtivos: 5 * H, metas: METAS, horaLimite: 23, agora: AGORA_20H,
  });
  assert.equal(facil.tipo, "alcancavel");
  assert.ok(facil.chegaEm > AGORA_20H);
  assert.ok(perto(facil.ritmo, 40));

  const dificil = M.projecaoDetalhada({
    saldo: 100, ganho: 100, msAtivos: 5 * H, metas: METAS, horaLimite: 21, agora: AGORA_20H,
  });
  assert.equal(dificil.tipo, "aperto");
  assert.ok(perto(dificil.horasRestantes, 1, 0.01));
  assert.ok(perto(dificil.ritmoNecessario, 180), `pediu ${dificil.ritmoNecessario}`);
  assert.ok(perto(dificil.ritmo, 20));
});

teste("projeção sem ritmo e com tudo batido", () => {
  assert.equal(
    M.projecaoDetalhada({ saldo: 0, ganho: 0, msAtivos: 5 * H, metas: METAS, horaLimite: 23 }).tipo,
    "sem_ritmo"
  );
  assert.equal(
    M.projecaoDetalhada({ saldo: 500, ganho: 500, msAtivos: 5 * H, metas: METAS, horaLimite: 23 }).tipo,
    "completa"
  );
});

teste("hora limite já passada é amanhã, não um prazo negativo", () => {
  const agora = new Date(2026, 7, 25, 23, 30).getTime();
  const p = M.projecaoDetalhada({ saldo: 100, ganho: 100, msAtivos: 5 * H, metas: METAS, horaLimite: 2, agora });
  assert.ok(p.horasRestantes > 0, `restaram ${p.horasRestantes}h`);
  assert.ok(perto(p.horasRestantes, 2.5, 0.01));
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

/* ------------------------------------------------------------ combustivel */

const abastece = (odometro, valor, litros, tipo = "gnv") => ({
  id: `f${odometro}`,
  timestamp: t0 + odometro,
  tipo,
  valor,
  litros,
  odometro,
});

teste("custo por km precisa de dois abastecimentos", () => {
  assert.equal(M.analiseAbastecimentos([]).suficiente, false);
  assert.equal(M.analiseAbastecimentos([abastece(100000, 90, 21)]).suficiente, false);
  assert.equal(M.analiseAbastecimentos([abastece(100000, 90, 21)]).porKm, null);
});

teste("convenção de tanque cheio: gasto conta do segundo em diante", () => {
  // 100000 -> 100400 = 400 km, e o que pagou nesse trecho foram os R$180 dos
  // dois abastecimentos seguintes. O primeiro pagou combustível queimado antes.
  const a = M.analiseAbastecimentos([
    abastece(100000, 90, 21),
    abastece(100200, 90, 20),
    abastece(100400, 90, 20),
  ]);
  assert.equal(a.suficiente, true);
  assert.equal(a.kmPeriodo, 400);
  assert.equal(a.gasto, 180, "o primeiro abastecimento fica fora do numerador");
  assert.ok(perto(a.porKm, 0.45), `deu ${a.porKm}`);
});

teste("consumo por combustível só sai entre tanques do mesmo tipo", () => {
  const a = M.analiseAbastecimentos([
    abastece(100000, 90, 21, "gnv"),
    abastece(100200, 90, 20, "gnv"),
    abastece(100300, 60, 10, "etanol"),
  ]);
  // 200 km com 20 m³ = 10 km/m³
  assert.ok(perto(a.consumos.gnv.media, 10));
  assert.equal(a.consumos.gnv.amostras, 1);
  assert.equal(a.consumos.etanol, undefined, "gnv -> etanol não é um tanque medível");
});

teste("abastecimento sem odômetro não entra na conta", () => {
  const semOdo = { id: "x", timestamp: t0, tipo: "gnv", valor: 90, litros: 21, odometro: null };
  assert.equal(M.analiseAbastecimentos([abastece(100000, 90, 21), semOdo]).suficiente, false);
});

teste("custo medido substitui a semente e recalcula o líquido", () => {
  const semMedida = M.custosEstimados(200, CONFIG_PADRAO);
  assert.equal(semMedida.medido, false);
  assert.ok(perto(semMedida.energiaKm, 0.437, 0.002));

  const comMedida = M.custosEstimados(200, CONFIG_PADRAO, 0.52);
  assert.equal(comMedida.medido, true);
  assert.ok(perto(comMedida.energiaKm, 0.52));
  assert.ok(perto(comMedida.total, (0.52 + 0.25) * 200));
  assert.ok(perto(M.liquidoEstimado(350, 200, CONFIG_PADRAO, 0.52), 350 - 154));
});

teste("gastos que não são combustível somam à parte", () => {
  const lista = [
    abastece(100000, 90, 21),
    { id: "p", timestamp: t0, tipo: "pedagio", valor: 12 },
    { id: "a", timestamp: t0, tipo: "alimentacao", valor: 25 },
  ];
  assert.equal(M.outrosCustos(lista), 37);
  assert.equal(M.ehCombustivel("gnv"), true);
  assert.equal(M.ehCombustivel("pedagio"), false);
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
