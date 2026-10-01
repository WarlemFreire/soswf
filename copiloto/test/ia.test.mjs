// Testes do assistente. node copiloto/test/ia.test.mjs
//
// O que está sob teste aqui, acima de tudo, é O QUE SAI DO APARELHO. Até este
// módulo existir, nada saía. Agora sai um resumo numérico — e a lista do que
// NÃO vai junto precisa ser verificável por teste, não por leitura de código.
import assert from "node:assert/strict";
import * as IA from "../js/ia.js";

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

const HOJE = new Date(2026, 9, 1, 12, 0, 0).getTime();
const DIA = 86400000;

const dia = (offset, extra = {}) => ({
  data: new Date(HOJE - offset * DIA).toISOString().slice(0, 10),
  inicio: HOJE - offset * DIA,
  saldo: 320.5,
  km: 148.33,
  msAtivo: 8.5 * 3600000,
  liquido: 240.12,
  temLiquido: true,
  corridas: [{}, {}, {}],
  ...extra,
});

/* ---------------------------------------------------- o que NÃO sai */

teste("coordenada do rastro não vai no contexto", () => {
  const c = IA.montarContexto({
    dias: [dia(1, { lat: -19.9191, lon: -43.9386, trilha: [{ lat: -19.9, lon: -43.9 }] })],
    hoje: HOJE,
  });
  const texto = JSON.stringify(c);
  assert.equal(texto.includes("-19.9"), false, "latitude vazou");
  assert.equal(texto.includes("-43.9"), false, "longitude vazou");
  assert.equal(texto.includes("trilha"), false);
});

teste("bairro de risco e endereço não vão no contexto", () => {
  const c = IA.montarContexto({
    dias: [dia(1, { bairros: ["Marapicu"], endereco: "Rua X, 120" })],
    config: { zonasRisco: [{ nome: "Marapicu", termos: ["Marapicu"] }], nome: "Warlem" },
    hoje: HOJE,
  });
  const texto = JSON.stringify(c);
  assert.equal(texto.includes("Marapicu"), false, "bairro marcado vazou");
  assert.equal(texto.includes("Rua X"), false, "endereço vazou");
  assert.equal(texto.includes("Warlem"), false, "nome vazou");
});

teste("corrida individual não vai — só a contagem", () => {
  const c = IA.montarContexto({
    dias: [dia(1, { corridas: [{ valorBruto: 14.03, bairroOrigem: "Centro" }] })],
    hoje: HOJE,
  });
  const texto = JSON.stringify(c);
  assert.equal(texto.includes("14.03"), false, "valor de corrida vazou");
  assert.equal(texto.includes("Centro"), false);
  assert.equal(c.dias[0].corridas, 1, "a contagem, sim, vai");
});

teste("o contexto é só o que foi declarado", () => {
  const c = IA.montarContexto({ dias: [dia(1)], hoje: HOJE });
  assert.deepEqual(
    Object.keys(c).sort(),
    ["custosPorCategoria", "diagnostico", "dias", "faixasDaJornada", "faixasDaOferta",
     "hoje", "mes", "ofensiva", "parametros", "semana", "sugestoesAnteriores"].sort()
  );
  assert.deepEqual(
    Object.keys(c.dias[0]).sort(),
    ["bruto", "corridas", "data", "horas", "km", "liquido"].sort()
  );
});

/* ------------------------------------------------------- o que sai */

teste("a janela corta o histórico antigo", () => {
  const c = IA.montarContexto({ dias: [dia(200), dia(2)], hoje: HOJE });
  assert.equal(c.dias.length, 1, "dia de 200 dias atrás não entra");
});

teste("números saem arredondados, não com 14 casas", () => {
  const c = IA.montarContexto({ dias: [dia(1, { km: 148.3333333333 })], hoje: HOJE });
  assert.equal(c.dias[0].km, 148.3);
});

teste("dia sem líquido vira nulo, não zero", () => {
  const c = IA.montarContexto({ dias: [dia(1, { temLiquido: false, liquido: 0 })], hoje: HOJE });
  assert.equal(c.dias[0].liquido, null, "zero mentiria; nulo diz que falta");
});

teste("dia sem tempo ativo vira nulo", () => {
  const c = IA.montarContexto({ dias: [dia(1, { msAtivo: null })], hoje: HOJE });
  assert.equal(c.dias[0].horas, null);
});

teste("as duas escalas de R$/km vão com nomes diferentes", () => {
  const c = IA.montarContexto({
    faixas: { tarde: { km: { piso: 1.7 } } },
    aceite: { tarde: { km: { piso: 3.1 } } },
    hoje: HOJE,
  });
  assert.ok(c.faixasDaJornada, "faixa da jornada presente");
  assert.ok(c.faixasDaOferta, "faixa da oferta presente");
  assert.notEqual(
    JSON.stringify(c.faixasDaJornada),
    JSON.stringify(c.faixasDaOferta),
    "se saíssem iguais, o modelo misturaria as escalas"
  );
});

teste("o fechamento declara se o combustível foi medido ou estimado", () => {
  const c = IA.montarContexto({
    fechamentoSemana: {
      dias: 5, bruto: 1600, km: 700, msAtivo: 40 * 3600000,
      combustivel: { valor: 300, fonte: "estimado" },
      outros: { valor: 50 }, liquido: 1250,
      reserva: { desgaste: 175, imposto: 0 }, sobra: 1075,
      reaisPorHora: 31.25, reaisPorKm: 1.78, completo: true,
    },
    hoje: HOJE,
  });
  assert.equal(c.semana.combustivelMedido, false, "estimado tem que ser declarado");
  assert.equal(c.semana.completo, true);
});

/* ---------------------------------------------------------- prompt */

teste("região vai como rótulo neutro, sem coordenada", () => {
  const c = IA.montarContexto({
    diagnostico: { regioes: [{ regiao: "região 1", celula: "-1992:-4394", reaisPorHora: 44 }] },
    hoje: HOJE,
  });
  // A célula é coordenada disfarçada: identifica o quarteirão onde ele roda.
  assert.equal(JSON.stringify(c).includes("-1992"), false, "célula vazou");
});

teste("o prompt diz que região é a experiência dele, não a cidade", () => {
  const p = IA.promptDoSistema();
  assert.ok(/melhor da cidade/i.test(p), "a ressalva sobre região precisa estar lá");
  assert.ok(/ENTRE AS QUE ELE RODOU/.test(p));
});

teste("o prompt manda não repetir sugestão que não rendeu", () => {
  const p = IA.promptDoSistema();
  assert.ok(/nao-rendeu/.test(p), "o placar precisa ter efeito no prompt");
  assert.ok(/sem-dado/.test(p), "não seguiu não é fracasso");
});

teste("o prompt limita a duas mudanças", () => {
  assert.ok(/DUAS mudanças/.test(IA.promptDoSistema()), "lista de dez vira nenhuma");
});

teste("o prompt carrega as regras que custaram caro", () => {
  const p = IA.promptDoSistema();
  assert.ok(/NUNCA INVENTE NÚMERO/.test(p), "a regra principal tem que estar lá");
  assert.ok(/DUAS ESCALAS/.test(p), "as duas escalas de R$/km");
  assert.ok(/desgaste/i.test(p), "desgaste é reserva, não custo deduzido");
  assert.ok(/semáforo/i.test(p), "não decide corrida específica");
  assert.ok(/cansa/i.test(p), "não empurra para dirigir cansado");
});

teste("as mensagens levam o sistema e os dados", () => {
  const msgs = IA.montarMensagens("E aí?", { hoje: "2026-10-01" });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
  assert.ok(msgs[1].content.includes("2026-10-01"), "os dados vão na mensagem");
  assert.ok(msgs[1].content.includes("E aí?"), "a pergunta também");
});

/* ------------------------------------------------------ configuração */

teste("sem chave e sem modelo não está configurado", () => {
  assert.equal(IA.temChave({ iaChave: "" }), false);
  assert.equal(IA.temChave({ iaChave: "  " }), false, "espaço não é chave");
  assert.equal(IA.temChave({ iaChave: "sk-or-x" }), true);
  assert.equal(IA.configurada({ iaChave: "sk-or-x", iaModelo: "" }), false, "falta o modelo");
  assert.equal(IA.configurada({ iaChave: "sk-or-x", iaModelo: "um/modelo" }), true);
});

console.log(`✓ ${passou} testes passaram`);
