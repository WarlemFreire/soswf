// Testes do planejador de rotina. node copiloto/test/rotina.test.mjs
import assert from "node:assert/strict";
import * as R from "../js/rotina.js";

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
const h = (hora, minuto = 0) => hora * 60 + minuto;

function comDias(mapa) {
  const rotina = R.rotinaVazia();
  for (const [dia, blocos] of Object.entries(mapa)) rotina.dias[dia] = blocos;
  return rotina;
}
const rodar = (inicio, fim) => ({ tipo: "trabalho", inicio, fim });
const almoco = (inicio, fim) => ({ tipo: "almoco", inicio, fim });

/* ---------------------------------------------------------------- modelo */

teste("normalizar devolve sempre os sete dias, em ordem", () => {
  const r = R.normalizar({ dias: { 3: [rodar(h(18), h(22)), rodar(h(8), h(12))] } });
  assert.equal(Object.keys(r.dias).length, 7);
  assert.deepEqual(r.dias[3].map((b) => b.inicio), [h(8), h(18)]);
  assert.deepEqual(r.dias[0], []);
});

teste("bloco inválido não entra", () => {
  const r = R.normalizar({ dias: { 1: [rodar(h(10), h(10)), rodar(h(12), h(9)), { tipo: "x", inicio: 0, fim: 60 }] } });
  assert.equal(r.dias[1].length, 1, "só o de tipo desconhecido sobrevive, virando trabalho");
  assert.equal(r.dias[1][0].tipo, "trabalho");
});

teste("turno que passa da meia-noite fica no dia em que começou", () => {
  // Quem roda de madrugada teria a semana picotada se o turno das 22h às 2h
  // fosse dividido entre dois dias.
  const r = R.normalizar({ dias: { 5: [rodar(h(22), h(26))] } });
  assert.equal(r.dias[5].length, 1);
  assert.equal(R.resumoDoDia(r.dias[5]).trabalho, 4 * 60);
  assert.equal(R.formatarMinutos(h(26)), "02:00 ⁺¹");
});

teste("bloco que começa depois da meia-noite continua no mesmo dia", () => {
  // Numa noite das 21h às 4h, a pausa da 1h e o trecho seguinte pertencem ao
  // dia em que a noite começou. Prender o início em 23:59 empurrava o bloco
  // para cima do anterior e fabricava conflito onde não havia.
  const blocos = [rodar(h(21), h(23)), almoco(h(23), h(24)), rodar(h(24), h(28))];
  const r = R.normalizar({ dias: { 1: blocos } });
  assert.equal(r.dias[1].length, 3);
  assert.equal(r.dias[1][2].inicio, h(24));
  assert.equal(R.conflitos(r.dias[1]).length, 0);
  assert.equal(R.resumoDoDia(r.dias[1]).trabalho, 6 * 60);
});

/* ---------------------------------------------------------------- totais */

teste("resumo separa volante de pausa e mede a janela", () => {
  const blocos = [rodar(h(6), h(12)), almoco(h(12), h(13)), rodar(h(13), h(17))];
  const d = R.resumoDoDia(blocos);
  assert.equal(d.trabalho, 10 * 60);
  assert.equal(d.pausa, 60);
  assert.equal(d.janela, 11 * 60, "da primeira à última hora fora de casa");
  assert.equal(d.turnos, 1, "pausa no meio não abre turno novo");
});

teste("ir para casa e voltar abre um turno novo", () => {
  const blocos = [rodar(h(6), h(10)), rodar(h(18), h(23))];
  assert.equal(R.resumoDoDia(blocos).turnos, 2);
  assert.equal(R.turnosDe(blocos)[1].trabalho, 5 * 60);
});

teste("dois blocos no mesmo minuto viram conflito", () => {
  const blocos = [rodar(h(8), h(14)), rodar(h(13), h(18))];
  assert.equal(R.conflitos(blocos).length, 1);
  assert.equal(R.conflitos([rodar(h(8), h(13)), rodar(h(13), h(18))]).length, 0, "encostar não é sobrepor");
});

teste("semana soma, conta folgas e acha o maior dia", () => {
  const r = comDias({ 1: [rodar(h(6), h(14))], 2: [rodar(h(6), h(16))], 5: [rodar(h(18), h(23))] });
  const s = R.resumoDaSemana(r);
  assert.equal(s.trabalho, (8 + 10 + 5) * 60);
  assert.equal(s.diasRodados, 3);
  assert.equal(s.folgas, 4);
  assert.ok(perto(s.media, (23 * 60) / 3));
  assert.equal(s.maiorDia.dia, 2);
});

/* ------------------------------------------------------------- relógio */

teste("minutos caem na hora certa do relógio, inclusive depois da meia-noite", () => {
  const r = comDias({ 6: [rodar(h(22), h(26))] });
  const horas = R.minutosPorHora(r);
  assert.equal(horas[22], 60);
  assert.equal(horas[23], 60);
  assert.equal(horas[0], 60, "1h depois da meia-noite é a hora 0");
  assert.equal(horas[1], 60);
  assert.equal(horas.reduce((a, b) => a + b, 0), 4 * 60);
});

teste("pausa não conta como hora rodada", () => {
  const r = comDias({ 1: [rodar(h(11), h(12)), almoco(h(12), h(13)), rodar(h(13), h(14))] });
  const horas = R.minutosPorHora(r);
  assert.equal(horas[12], 0);
  assert.equal(horas[11] + horas[13], 120);
});

teste("períodos recebem o que é deles", () => {
  const r = comDias({ 1: [rodar(h(23), h(27))] }); // 23h→3h: pico e madrugada
  const p = R.minutosPorPeriodo(r);
  assert.equal(p.pico, 3 * 60, "22h–2h");
  assert.equal(p.madrugada, 60, "2h–6h");
  assert.equal(p.manha + p.tarde + p.noite, 0);
});

/* ------------------------------------------------------------- projeção */

teste("projeção usa a taxa medida de cada hora", () => {
  const taxaPorHora = new Array(24).fill(null);
  taxaPorHora[8] = 40;
  taxaPorHora[9] = 20;
  const r = comDias({ 1: [rodar(h(8), h(10))] });
  const p = R.projecao(r, { taxaPorHora, taxaPadrao: 30 });
  assert.equal(p.ganho, 60, "uma hora a 40 e outra a 20");
  assert.equal(p.cobertura, 1);
});

teste("hora sem histórico cai no padrão e derruba a cobertura", () => {
  const taxaPorHora = new Array(24).fill(null);
  taxaPorHora[8] = 40;
  const r = comDias({ 1: [rodar(h(8), h(10))] });
  const p = R.projecao(r, { taxaPorHora, taxaPadrao: 30 });
  assert.equal(p.ganho, 70);
  assert.ok(perto(p.cobertura, 0.5), "metade do plano é chute, e a tela precisa poder dizer");
});

teste("rotina vazia projeta zero sem dividir por zero", () => {
  const p = R.projecao(R.rotinaVazia(), { taxaPorHora: [], taxaPadrao: 30 });
  assert.equal(p.ganho, 0);
  assert.equal(p.cobertura, 0);
});

/* --------------------------------------------------------------- avisos */

teste("dia longo demais vira alerta", () => {
  const r = comDias({ 1: [rodar(h(5), h(18))] }); // 13h
  const a = R.avisos(r).find((x) => x.tipo === "dia_longo");
  assert.ok(a);
  assert.equal(a.grau, "alerta");
  assert.ok(a.texto.includes("13h"));
});

teste("turno longo sem pausa planejada é avisado uma vez só", () => {
  const r = comDias({ 2: [rodar(h(6), h(14))] });
  const achados = R.avisos(r).filter((x) => x.tipo === "sem_pausa");
  assert.equal(achados.length, 1);

  const comParada = comDias({ 2: [rodar(h(6), h(11)), almoco(h(11), h(12)), rodar(h(12), h(14))] });
  assert.equal(R.avisos(comParada).filter((x) => x.tipo === "sem_pausa").length, 0);
});

teste("descanso curto entre dois dias é visto, inclusive virando a semana", () => {
  const r = comDias({ 6: [rodar(h(16), h(26))], 0: [rodar(h(6), h(12))] }); // sáb termina 2h, dom começa 6h
  const a = R.avisos(r).find((x) => x.tipo === "descanso_curto");
  assert.ok(a, "sábado 2h → domingo 6h são só 4h de descanso");
  assert.equal(a.dia, 6);
});

teste("três folgas seguidas quebram a ofensiva, e o plano avisa", () => {
  const r = comDias({ 1: [rodar(h(8), h(16))], 2: [rodar(h(8), h(16))] }); // folga de qua a dom
  const a = R.avisos(r).find((x) => x.tipo === "ofensiva");
  assert.ok(a, "quarta a domingo são cinco folgas seguidas");

  const espaçada = comDias({ 1: [rodar(h(8), h(16))], 4: [rodar(h(8), h(16))], 6: [rodar(h(8), h(16))] });
  assert.equal(R.avisos(espaçada).filter((x) => x.tipo === "ofensiva").length, 0, "duas folgas seguidas são permitidas");
});

teste("semana inteira sem folga é avisada", () => {
  const r = R.rotinaVazia();
  for (const d of R.DIAS) r.dias[d.id] = [rodar(h(8), h(16))];
  const tipos = R.avisos(r).map((x) => x.tipo);
  assert.ok(tipos.includes("sem_folga"));
  assert.ok(!tipos.includes("ofensiva"), "sem folga nenhuma não há sequência de folga");
});

teste("rotina vazia não gera aviso nenhum", () => {
  assert.deepEqual(R.avisos(R.rotinaVazia()), []);
});

/* ---------------------------------------------------------- formatação */

teste("formatação de hora e duração", () => {
  assert.equal(R.formatarMinutos(0), "00:00");
  assert.equal(R.formatarMinutos(h(7, 30)), "07:30");
  assert.equal(R.formatarMinutos(h(24)), "00:00 ⁺¹");
  assert.equal(R.formatarDuracao(0), "0min");
  assert.equal(R.formatarDuracao(45), "45min");
  assert.equal(R.formatarDuracao(h(8)), "8h");
  assert.equal(R.formatarDuracao(h(8, 30)), "8h30");
});

if (!process.exitCode) console.log(`✓ ${passou} testes passaram`);
