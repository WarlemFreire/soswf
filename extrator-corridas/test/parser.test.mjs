// Testes do parser. Roda com: node extrator-corridas/test/parser.test.mjs
// Nao precisa de imagem nem de navegador: o parser so mexe com texto.
//
// O texto das telas abaixo é a transcricao de um print de verdade da tela
// "Histórico de ganhos", com a sujeira que o OCR produz: barra de status,
// filtros, nome de restaurante que o mapa mostra e menu de baixo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analisar, dataDe, distanciaDe, duracaoDe, ehChrome, extrair, horaDe,
  juntarEnderecos, limparBorda, normalizar, padronizarBairros, paraCsv,
  partesDoEndereco, semRepetidas, tipoDe, totais, valorDe,
} from "../js/parser.js";

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

const HOJE = new Date(2026, 7, 29, 20, 0, 0); // 29/08/2026

const TELA_1 = `14:38
9 VoLTE 4G 57%
< Histórico de ganhos
Tipo v Recurso v 24/08 - 30/08 v
sex., 28 de ago.
R$ 4,39 0:32
Uber X · Você cancelou
TÁCIO PESS
La Cario
Babbo Osteria
R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ,
22410-050, BR
R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ,
22410-050, BR
R$ 0,00 0:29
Uber X · Cancelado pelo usuário
Sol Ipanema
Boteco Belmonte
Av. Vieira Souto, Arpoador, Ipanema - Rio de Janeiro - RJ,
22420-000, BR
Av. Vieira Souto, Arpoador, Ipanema - Rio de Janeiro - RJ,
22420-000, BR
R$ 7,04 0:20
Uber X · 7 min 29 segundos · 2.94 km
ca Anil Botafogo
Itanhangá 079
Página inicial Descubra Ganhos Caixa de entra... Menu`;

// O print seguinte, ja rolado: repete a ultima corrida do anterior (agora
// inteira, com endereço) e traz as proximas.
const TELA_2 = `14:39
9 VoLTE 4G 56%
< Histórico de ganhos
R$ 7,04 0:20
Uber X · 7 min 29 segundos · 2.94 km
Av. Ataulfo de Paiva, Leblon - Rio de Janeiro - RJ,
22440-032, BR
R. Voluntários da Pátria, Botafogo - Rio de Janeiro - RJ,
22270-010, BR
R$ 18,72 23:47
Uber Comfort · 21 min 3 segundos · 9.81 km
R. Barata Ribeiro, Copacabana - Rio de Janeiro - RJ,
22040-000, BR
Av. das Américas, Barra da Tijuca - Rio de Janeiro - RJ,
22640-102, BR
qui., 27 de ago.
R$ 32,15 21:05
Uber Black · 34 min 12 segundos · 15.4 km
Página inicial Descubra Ganhos Caixa de entra... Menu`;

/* ------------------------------------------------------------- pedacos */

teste("valor sai certo mesmo com o cifrao errado do OCR", () => {
  assert.equal(valorDe("R$ 4,39 0:32"), 4.39);
  assert.equal(valorDe(normalizar("RS 4,39")), 4.39);
  assert.equal(valorDe(normalizar("R5 24,50")), 24.5);
  assert.equal(valorDe("R$24.50"), 24.5);
  assert.equal(valorDe("Total R$ 1.842,30"), 1842.3);
  assert.equal(valorDe("R$ 0,00 0:29"), 0);
  assert.equal(valorDe("Uber X · Você cancelou"), null);
});

teste("taxa de cancelamento é ganho, nao desconto", () => {
  // R$ 4,39 numa corrida cancelada entra positivo: o Uber pagou isso.
  assert.equal(valorDe("R$ 4,39 0:32"), 4.39);
  assert.equal(valorDe("Ajuste -R$ 2,00"), -2);
});

teste("digito que o OCR trocou por letra volta a ser digito", () => {
  assert.equal(valorDe(normalizar("R$ 1O,5O")), 10.5);
  assert.equal(valorDe(normalizar("R$ 2S,00")), 25);
});

teste("hora, km e duracao do jeito que a tela escreve", () => {
  assert.equal(horaDe("R$ 4,39 0:32"), "00:32");
  assert.equal(horaDe("R$ 18,72 23:47"), "23:47");
  assert.equal(horaDe("R$ 24,50"), null, "valor nao pode virar hora");
  assert.equal(distanciaDe("Uber X · 7 min 29 segundos · 2.94 km"), 2.94);
  assert.equal(duracaoDe("Uber X · 7 min 29 segundos · 2.94 km"), 449);
  assert.equal(duracaoDe("1 h 5 min"), 3900);
});

teste("tipo com espaco no meio, que é como o app escreve", () => {
  assert.equal(tipoDe("Uber X · Você cancelou"), "Uber X");
  assert.equal(tipoDe("Uber Comfort · 21 min"), "Uber Comfort");
  assert.equal(tipoDe("Babbo Osteria"), null);
});

teste("data em todos os formatos que aparecem", () => {
  assert.equal(dataDe("sex., 28 de ago.", HOJE), "2026-08-28");
  assert.equal(dataDe("Hoje", HOJE), "2026-08-29");
  assert.equal(dataDe("Ontem", HOJE), "2026-08-28");
  assert.equal(dataDe("28/08/2026", HOJE), "2026-08-28");
  assert.equal(dataDe("15 de dez", HOJE), "2025-12-15", "mes que nao chegou é do ano passado");
});

teste("enfeite de tela nao vira dado", () => {
  assert.ok(ehChrome("9 VoLTE 4G 57%"), "barra de status");
  assert.ok(ehChrome("Tipo v Recurso v 24/08 - 30/08 v"), "chip do periodo");
  assert.ok(ehChrome("< Histórico de ganhos"));
  assert.ok(ehChrome("Página inicial Descubra Ganhos Caixa de entra... Menu"));
  assert.equal(ehChrome("R$ 7,04 0:20"), false);
  assert.equal(dataDe("Tipo v Recurso v 24/08 - 30/08 v", HOJE), null, "periodo do filtro nao é o dia");
});

teste("relogio da barra de status nao vira hora de corrida", () => {
  const { corridas } = analisar(TELA_1, { hoje: HOJE });
  assert.ok(!corridas.some((c) => c.hora === "14:38"));
});

/* ----------------------------------------------------------- enderecos */

teste("endereço quebrado em duas linhas volta a ser um so", () => {
  const juntas = juntarEnderecos([
    "R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ,",
    "22410-050, BR",
  ]);
  assert.deepEqual(juntas, ["R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ, 22410-050, BR"]);
});

teste("bairro, cidade, uf e cep saem do endereço", () => {
  assert.deepEqual(
    partesDoEndereco("R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ, 22410-050, BR"),
    {
      endereco: "R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ, 22410-050, BR",
      rua: "R. Aníbal de Mendonça",
      bairro: "Ipanema",
      cidade: "Rio de Janeiro",
      uf: "RJ",
      cep: "22410-050",
    },
  );
});

teste("com sub-bairro, o bairro é o ultimo antes do traço", () => {
  const p = partesDoEndereco("Av. Vieira Souto, Arpoador, Ipanema - Rio de Janeiro - RJ, 22420-000, BR");
  assert.equal(p.bairro, "Ipanema");
  assert.equal(p.rua, "Av. Vieira Souto, Arpoador");
});

/* -------------------------------------------------------------- leitura */

teste("le a tela inteira do print e monta as tres corridas", () => {
  const { corridas } = analisar(TELA_1, { hoje: HOJE });
  assert.equal(corridas.length, 3);
  assert.deepEqual(
    corridas.map((c) => [c.data, c.hora, c.tipo, c.valor, c.status]),
    [
      ["2026-08-28", "00:32", "Uber X", 4.39, "Você cancelou"],
      ["2026-08-28", "00:29", "Uber X", 0, "Cancelado pelo usuário"],
      ["2026-08-28", "00:20", "Uber X", 7.04, null],
    ],
  );
});

teste("a corrida completa traz km, duracao e os dois bairros", () => {
  const { corridas } = analisar(TELA_2, { hoje: HOJE });
  const c = corridas.find((x) => x.valor === 18.72);
  assert.equal(c.distanciaKm, 9.81);
  assert.equal(c.duracaoSeg, 1263);
  assert.equal(c.bairroOrigem, "Copacabana");
  assert.equal(c.bairroDestino, "Barra da Tijuca");
  assert.equal(c.cidade, "Rio de Janeiro");
  assert.equal(c.uf, "RJ");
});

teste("lixo do mapa nao vira corrida nem estraga a de cima", () => {
  const { corridas } = analisar(TELA_1, { hoje: HOJE });
  assert.equal(corridas[0].bairroOrigem, "Ipanema", "Babbo Osteria no meio nao atrapalhou");
  assert.equal(corridas[0].bairroDestino, "Ipanema");
});

teste("titulo de secao no meio da lista troca o dia", () => {
  const { corridas } = analisar(TELA_2, { hoje: HOJE });
  assert.deepEqual(corridas.map((c) => c.data), [null, null, "2026-08-27"]);
});

teste("a data atravessa de um print pro outro", () => {
  const r = extrair([TELA_1, TELA_2], { hoje: HOJE });
  assert.deepEqual(
    r.corridas.map((c) => [c.data, c.valor]),
    [
      ["2026-08-28", 4.39],
      ["2026-08-28", 0],
      ["2026-08-28", 7.04],
      ["2026-08-28", 18.72],
      ["2026-08-27", 32.15],
    ],
  );
});

teste("linha de total nao vira corrida", () => {
  const texto = `Ganhos da semana
R$ 1.842,30
sex., 28 de ago.
R$ 7,04 0:20
Uber X · 7 min 29 segundos · 2.94 km
Total do dia R$ 7,04`;
  const { corridas, ignoradas } = analisar(texto, { hoje: HOJE });
  assert.equal(corridas.length, 1);
  assert.equal(corridas[0].valor, 7.04);
  assert.equal(ignoradas.length, 2);
});

/* --------------------------------------------------------------- juncao */

teste("corrida repetida nos dois prints conta uma vez so", () => {
  const r = extrair([TELA_1, TELA_2], { hoje: HOJE });
  assert.equal(r.repetidas, 1, "a corrida das 0:20 estava nos dois prints");
  assert.equal(r.corridas.length, 5);
});

teste("a repetida completa o que faltava na primeira leitura", () => {
  // No TELA_1 a corrida das 0:20 aparece cortada, sem endereço nenhum.
  const so1 = analisar(TELA_1, { hoje: HOJE }).corridas.at(-1);
  assert.equal(so1.bairroOrigem, null);

  const r = extrair([TELA_1, TELA_2], { hoje: HOJE });
  const c = r.corridas.find((x) => x.valor === 7.04);
  assert.equal(c.bairroOrigem, "Leblon", "o print seguinte mostrou o endereço");
  assert.equal(c.bairroDestino, "Botafogo");
  assert.equal(c.distanciaKm, 2.94);
});

teste("duas corridas iguais em dias diferentes continuam sendo duas", () => {
  const r = extrair([TELA_1, TELA_1.replace("sex., 28 de ago.", "qui., 27 de ago.")], { hoje: HOJE });
  assert.equal(r.corridas.length, 6);
});

teste("totais, com cancelada contada a parte", () => {
  const r = extrair([TELA_1, TELA_2], { hoje: HOJE });
  assert.equal(r.totais.quantidade, 5);
  assert.equal(r.totais.valor, 62.3);
  assert.equal(r.totais.canceladas, 2);
  assert.equal(r.totais.distanciaKm, 28.15);
  assert.deepEqual(r.totais.porDia, [
    { data: "2026-08-27", corridas: 1, valor: 32.15 },
    { data: "2026-08-28", corridas: 4, valor: 30.15 },
  ]);
});

/* ----------------------------------------------------------------- csv */

teste("csv sai com ponto e virgula, virgula decimal e BOM", () => {
  const r = extrair([TELA_1, TELA_2], { hoje: HOJE });
  const linhas = paraCsv(r.corridas).split("\n");
  assert.ok(linhas[0].startsWith("﻿"), "BOM para o Excel");
  assert.equal(
    linhas[0].replace("﻿", ""),
    "data;hora;tipo;valor;dinâmico;status;km;duração (min);bairro origem;" +
      "bairro destino;endereço origem;endereço destino;cidade;uf;texto lido",
  );
  // O numero sai entre aspas porque tem virgula dentro, igual ao export do app.
  assert.ok(linhas[1].startsWith('2026-08-28;00:32;Uber X;"4,39";;Você cancelou;;;Ipanema;Ipanema;'));
  assert.equal(linhas.length, 6);
});

teste("tela sem nada nao quebra", () => {
  const r = extrair(["", "   \n\n  ", "Página inicial Descubra Ganhos"], { hoje: HOJE });
  assert.equal(r.corridas.length, 0);
  assert.equal(r.totais.valor, 0);
});

/* ------------------------------------------------- o print de verdade */

// ocr-real.txt é a saida crua do Tesseract em cima de um print de verdade da
// tela, com toda a sujeira: icone que virou "?", nome de restaurante do mapa,
// barra de status. Se um dia mexer no parser e quebrar isso aqui, quebrou pro
// motorista tambem.
const OCR_REAL = readFileSync(new URL("./ocr-real.txt", import.meta.url), "utf8");

teste("print de verdade, lido pelo OCR de verdade, da as tres corridas", () => {
  const { corridas } = analisar(OCR_REAL, { hoje: HOJE });
  assert.equal(corridas.length, 3);
  assert.deepEqual(
    corridas.map((c) => [c.data, c.hora, c.tipo, c.valor, c.status]),
    [
      ["2026-08-28", "00:32", "Uber X", 4.39, "Você cancelou"],
      ["2026-08-28", "00:29", "Uber X", 0, "Cancelado pelo usuário"],
      ["2026-08-28", "00:20", "Uber X", 7.04, null],
    ],
  );
});

teste("no print de verdade, km e duracao saem da linha do tipo", () => {
  const c = analisar(OCR_REAL, { hoje: HOJE }).corridas[2];
  // O OCR leu "294 km": o app escreve distancia com casa decimal, entao o
  // ponto se perdeu e a gente devolve.
  assert.equal(c.distanciaKm, 2.94);
  assert.equal(c.duracaoSeg, 449, "7 min 29 segundos");
});

teste("no print de verdade, o endereço sobrevive ao icone virando '?'", () => {
  const c = analisar(OCR_REAL, { hoje: HOJE }).corridas[0];
  assert.equal(c.bairroOrigem, "Ipanema");
  assert.equal(c.cidade, "Rio de Janeiro");
  assert.equal(c.uf, "RJ");
  assert.match(c.origem, /^R\. Aníbal de Mendonça/, "o '?' do pin saiu da frente");
});

teste("lixo de icone sai, mas R$ e R. ficam", () => {
  assert.equal(limparBorda("? R. Aníbal de Mendonça, Ipanema"), "R. Aníbal de Mendonça, Ipanema");
  assert.equal(limparBorda("2 R$ 7,04 0:20"), "R$ 7,04 0:20");
  assert.equal(limparBorda(": 22410-050, BR"), "22410-050, BR");
  assert.equal(limparBorda("R$ 4,39 0:32"), "R$ 4,39 0:32");
  assert.equal(limparBorda("Uber X - Você cancelou"), "Uber X - Você cancelou");
});

/* ------------------------------------------------------ bairro torto */

const comBairro = (b) => ({
  data: "2026-08-28", hora: null, tipo: "Uber X", valor: 10, dinamico: null,
  status: null, distanciaKm: null, duracaoSeg: null,
  origem: null, bairroOrigem: b, destino: null, bairroDestino: null,
  cidade: null, uf: null, textoBruto: "",
});

teste("bairro que o OCR errou uma vez vira o que aparece sempre", () => {
  const corridas = [...Array(9)].map(() => comBairro("Ipanema"));
  corridas.push(comBairro("Ibanema"));
  const { corrigidos } = padronizarBairros(corridas);
  assert.equal(corrigidos, 1);
  assert.equal(corridas[9].bairroOrigem, "Ipanema");
});

teste("dois bairros parecidos e igualmente comuns ficam como estao", () => {
  const corridas = [
    ...[...Array(4)].map(() => comBairro("Jardim Icaraí")),
    ...[...Array(5)].map(() => comBairro("Jardim Icaraú")),
  ];
  const { corrigidos } = padronizarBairros(corridas);
  assert.equal(corrigidos, 0, "contagem parecida: sao bairros diferentes mesmo");
});

console.log(`${passou} testes ok`);
