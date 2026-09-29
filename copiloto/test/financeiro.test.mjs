// Testes do fechamento financeiro. node copiloto/test/financeiro.test.mjs
import assert from "node:assert/strict";
import * as F from "../js/financeiro.js";
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

const config = {
  mixGnvPct: 100, precoGnv: 4.3, kmPorM3: 10,
  kmPorLitro: 8, precoEtanol: 4.2, custoDesgasteKm: 0.25,
};

const resumo = (data, { saldo = 300, km = 150, horas = 8, custos = [] } = {}) => ({
  jornada: { data },
  saldo, km, msAtivo: horas * M.HORA, custos,
});

const gasto = (tipo, valor) => ({ tipo, valor });
const perto = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------- janelas */

teste("a semana começa na segunda", () => {
  // 2026-09-28 é uma segunda; 27 é domingo e pertence à semana anterior.
  assert.equal(F.chaveDoPeriodo("2026-09-28", "semana"), "2026-09-28");
  assert.equal(F.chaveDoPeriodo("2026-10-04", "semana"), "2026-09-28", "domingo fecha a semana da segunda");
  assert.equal(F.chaveDoPeriodo("2026-09-27", "semana"), "2026-09-21");
});

teste("mês agrupa por ano e mês", () => {
  assert.equal(F.chaveDoPeriodo("2026-09-28", "mes"), "2026-09");
  assert.equal(F.chaveDoPeriodo("2026-01-01", "mes"), "2026-01");
});

teste("períodos vêm do mais recente para o mais antigo", () => {
  const p = F.porPeriodo(
    [resumo("2026-09-01"), resumo("2026-09-28"), resumo("2026-09-29")],
    "mes"
  );
  assert.equal(p.length, 1);
  assert.equal(p[0].resumos.length, 3);

  const semanas = F.porPeriodo([resumo("2026-09-01"), resumo("2026-09-28")], "semana");
  assert.equal(semanas.length, 2);
  assert.ok(semanas[0].chave > semanas[1].chave, "mais recente primeiro");
});

/* ---------------------------------------------------------- fechamento */

teste("combustível lançado ganha da estimativa", () => {
  const f = F.fechamento([resumo("2026-09-28", { custos: [gasto("gnv", 40)] })], { config });
  assert.equal(f.combustivel.fonte, "lancado");
  assert.equal(f.combustivel.valor, 40);
});

teste("sem abastecimento lançado cai para estimativa, e diz que caiu", () => {
  const f = F.fechamento([resumo("2026-09-28", { km: 100 })], { config });
  assert.equal(f.combustivel.fonte, "estimado");
  // 100 km a 4,30/10 = 43
  assert.ok(perto(f.combustivel.valor, 43), `veio ${f.combustivel.valor}`);
});

teste("líquido é bruto menos combustível menos lançados", () => {
  const f = F.fechamento(
    [resumo("2026-09-28", { saldo: 300, km: 100, custos: [gasto("gnv", 40), gasto("lavagem", 25)] })],
    { config }
  );
  assert.equal(f.liquido, 300 - 40 - 25);
});

teste("DESGASTE NÃO SAI DO LÍQUIDO — ele é reserva, senão a manutenção sairia duas vezes", () => {
  const comManutencao = F.fechamento(
    [resumo("2026-09-28", { saldo: 300, km: 100, custos: [gasto("gnv", 40), gasto("manutencao", 200)] })],
    { config }
  );
  // A manutenção real reduz o líquido uma vez, e só uma.
  assert.equal(comManutencao.liquido, 300 - 40 - 200);
  // E o desgaste aparece separado, como provisão.
  assert.ok(perto(comManutencao.reserva.desgaste, 25), "100 km × 0,25");
  assert.ok(
    comManutencao.liquido < comManutencao.bruto - 40 - 200 + 0.001,
    "o desgaste não pode ter sido descontado também"
  );
});

teste("imposto é percentual do bruto e entra na reserva, não no líquido", () => {
  const f = F.fechamento([resumo("2026-09-28", { saldo: 1000, km: 100 })], { config, impostoPct: 6 });
  assert.equal(f.reserva.imposto, 60);
  assert.equal(f.liquido, 1000 - f.combustivel.valor, "imposto não desce do líquido");
  assert.equal(f.sobra, f.liquido - f.reserva.total);
});

teste("dia sem km deixa o fechamento incompleto, e ele avisa", () => {
  const f = F.fechamento([resumo("2026-09-28", { km: 0 }), resumo("2026-09-29", { km: 100 })], { config });
  assert.equal(f.completo, false);
  assert.equal(f.diasSemKm, 1);
});

teste("R$/h e R$/km do fechamento são LÍQUIDOS, não brutos", () => {
  const f = F.fechamento(
    [resumo("2026-09-28", { saldo: 400, km: 100, horas: 10, custos: [gasto("gnv", 100)] })],
    { config }
  );
  assert.equal(f.liquido, 300);
  assert.ok(perto(f.reaisPorHora, 30), `esperava 30, veio ${f.reaisPorHora}`);
  assert.ok(perto(f.reaisPorKm, 3), `esperava 3, veio ${f.reaisPorKm}`);
});

teste("janela vazia não quebra e não inventa número", () => {
  const f = F.fechamento([], { config });
  assert.equal(f.bruto, 0);
  assert.equal(f.reaisPorHora, null, "sem tempo não existe R$/h — travessão, não zero");
  assert.equal(f.reaisPorKm, null);
});

/* ---------------------------------------------------------- categorias */

teste("categorias saem ordenadas e com fatia", () => {
  const r = F.porCategoria([gasto("gnv", 100), gasto("lavagem", 20), gasto("manutencao", 80)]);
  assert.equal(r.total, 200);
  assert.equal(r.fatias[0].id, "gnv");
  assert.ok(perto(r.fatias[0].fatia, 0.5));
});

teste("a cauda vira Outros em vez de gerar uma quinta cor", () => {
  const r = F.porCategoria([
    gasto("gnv", 100), gasto("manutencao", 50), gasto("lavagem", 30),
    gasto("pedagio", 10), gasto("alimentacao", 8), gasto("outro", 2),
  ]);
  assert.equal(r.fatias.length, 4, "a paleta só tem quatro tons que se separam sob daltonismo");
  assert.equal(r.fatias[3].nome, "Outros");
  assert.equal(r.fatias[3].valor, 20, "10 + 8 + 2");
});

teste("uma só categoria na cauda mantém o nome próprio", () => {
  const r = F.porCategoria([gasto("gnv", 100), gasto("manutencao", 50), gasto("lavagem", 30), gasto("pedagio", 10)]);
  assert.equal(r.fatias.length, 4);
  assert.equal(r.fatias[3].nome, "Pedágio", "não vira 'Outros' quando é uma só");
});

teste("sem custo nenhum não há fatia", () => {
  assert.deepEqual(F.porCategoria([]), { total: 0, fatias: [] });
});

/* -------------------------------------------------------- conciliação */

teste("conciliação aponta a diferença e o sentido", () => {
  const c = F.conciliacao({ registrado: 1000, informado: 940 });
  assert.equal(c.diferenca, -60);
  assert.equal(c.aFavor, false);
  assert.ok(perto(c.pct, -6));
});

teste("conciliação sem base não divide por zero", () => {
  const c = F.conciliacao({ registrado: 0, informado: 100 });
  assert.equal(c.pct, null, "sem base não existe percentual");
});

teste("conciliação com entrada inválida devolve nulo", () => {
  assert.equal(F.conciliacao({ registrado: "abc", informado: 10 }), null);
});

console.log(`✓ ${passou} testes passaram`);
