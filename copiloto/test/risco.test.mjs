// Testes das áreas de risco. node copiloto/test/risco.test.mjs
//
// O que está sob teste é o alarme falso. Um aviso que dispara em corrida boa
// ensina o motorista a ignorar o aviso — e aí o verdadeiro passa batido também.
import assert from "node:assert/strict";
import * as R from "../js/risco.js";

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

const area = (nome, termos, nivel = "atencao") => ({ id: nome, nome, termos, nivel, ativa: true });

teste("acento e caixa não atrapalham", () => {
  assert.ok(R.casa("Corrida para o MORRO DO PAPAGAIO", "Morro do Papagaio"));
  assert.ok(R.casa("Destino: Ribeirão das Neves", "ribeirao das neves"));
  assert.ok(R.casa("bairro sao joao batista", "São João Batista"));
});

teste("pontuação da tela não quebra o casamento", () => {
  assert.ok(R.casa("Destino — Alto Vera Cruz, BH", "Alto Vera Cruz"));
  assert.ok(R.casa("Rua X, 120 · Cabana Pai Tomás", "Cabana Pai Tomás"));
});

teste("NÃO casa pedaço de palavra — este é o teste do alarme falso", () => {
  assert.equal(R.casa("Cabana Pai Tomás", "Ana"), false, "'Ana' dentro de 'Cabana' não é a área");
  assert.equal(R.casa("Contagem", "conta"), false);
  assert.equal(R.casa("Barreiro", "barro"), false);
});

teste("termo de duas palavras exige as duas, em sequência", () => {
  assert.ok(R.casa("indo para o Alto Vera Cruz", "Alto Vera Cruz"));
  assert.equal(R.casa("Alto Barroca e Santa Cruz", "Alto Vera Cruz"), false, "palavras soltas não bastam");
});

teste("termo curto demais é recusado na entrada", () => {
  assert.equal(R.termoValido("SP"), false);
  assert.equal(R.termoValido("a b"), false);
  assert.ok(R.termoValido("Bar"));
});

teste("avaliar acha a área no texto da oferta", () => {
  const achadas = R.avaliar(
    "UberX R$ 14,03\n4,5 km\n12 min\nMorro do Papagaio",
    [area("Papagaio", ["Morro do Papagaio"])]
  );
  assert.equal(achadas.length, 1);
  assert.equal(achadas[0].nome, "Papagaio");
});

teste("a mais grave vem primeiro, porque só uma cabe no selo", () => {
  const achadas = R.avaliar("vai para Vila Nova e passa no Centro", [
    area("Centro", ["Centro"], "atencao"),
    area("Vila Nova", ["Vila Nova"], "evitar"),
  ]);
  assert.equal(R.maisGrave(achadas).nivel, "evitar");
  assert.equal(R.maisGrave(achadas).nome, "Vila Nova");
});

teste("área desligada não dispara", () => {
  const achadas = R.avaliar("Morro do Papagaio", [{ ...area("P", ["Morro do Papagaio"]), ativa: false }]);
  assert.equal(achadas.length, 0);
});

teste("sem área cadastrada nada dispara", () => {
  assert.deepEqual(R.avaliar("qualquer coisa", []), []);
  assert.deepEqual(R.avaliar("", [area("X", ["X Y Z"])]), []);
});

teste("normalizarArea limpa termos ruins e duplicados", () => {
  const a = R.normalizarArea({ nome: "  Zona A ", termos: ["Vila Nova", "Vila Nova", "  ", "ab"], nivel: "evitar" });
  assert.deepEqual(a.termos, ["Vila Nova"]);
  assert.equal(a.nome, "Zona A");
  assert.equal(a.nivel, "evitar");
  assert.equal(a.ativa, true);
});

teste("área sem nome não fica sem rótulo no selo", () => {
  assert.equal(R.normalizarArea({ termos: ["Vila Nova"] }).nome, "Sem nome");
});

teste("nível desconhecido cai para atenção, nunca para recusa", () => {
  assert.equal(R.normalizarArea({ nome: "X", termos: ["Vila Nova"], nivel: "sei-la" }).nivel, "atencao");
});

teste("paraOServico já entrega normalizado, para o Java não repetir a conta", () => {
  const saida = R.paraOServico([area("P", ["Morro do Papagaio", "ab"], "evitar")]);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0].termos, ["morro do papagaio"], "sem acento, minúsculo, e o termo curto fora");
});

teste("área sem termo válido não vai para o serviço", () => {
  assert.equal(R.paraOServico([area("P", ["ab"])]).length, 0);
});

console.log(`✓ ${passou} testes passaram`);
