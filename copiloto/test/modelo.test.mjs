// Testes do aprendizado local. node copiloto/test/modelo.test.mjs
//
// O que precisa ser provado aqui não é que o código roda: é que ele APRENDE,
// que a memória NÃO CRESCE, e que ele ADMITE quando não aprendeu nada.
import assert from "node:assert/strict";
import * as Mod from "../js/modelo.js";
import * as T from "../js/treino.js";

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

const SEG = new Date(2026, 9, 5, 14, 0, 0).getTime(); // segunda, 14h
const H = 3600000;

/** Gerador determinístico, para o teste não depender de sorte. */
function aleatorio(semente) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/* --------------------------------------------------- memória constante */

teste("a memória NÃO cresce com o uso — este é o ponto", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(1);
  for (let i = 0; i < 50; i++) {
    Mod.treinar(m, { quando: SEG + i * H, regiao: `c${i % 3}` }, 40 + r() * 10);
  }
  const depoisDe50 = JSON.stringify(Mod.serializar(m)).length;

  for (let i = 50; i < 5000; i++) {
    Mod.treinar(m, { quando: SEG + i * H, regiao: `c${i % 3}` }, 40 + r() * 10);
  }
  const depoisDe5000 = JSON.stringify(Mod.serializar(m)).length;

  assert.equal(m.n, 5000, "contou as 5000 observações");
  // Só variam as casas decimais dos números, nunca a quantidade deles.
  const variacao = Math.abs(depoisDe5000 - depoisDe50) / depoisDe50;
  assert.ok(variacao < 0.25, `tamanho variou ${(variacao * 100).toFixed(0)}% — deveria ser quase nada`);
});

teste("o teto de regiões segura a dimensão", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 100; i++) Mod.registrarRegiao(m, `celula-${i}`);
  assert.equal(m.regioes.length, Mod.MAX_REGIOES, "regiões sobrando caem no balde 'outra'");
  assert.equal(Mod.caracteristicas({ quando: SEG, regiao: "celula-99" }, m.regioes).length, Mod.dimensao());
});

/* ------------------------------------------------------------ aprende */

teste("aprende que uma região rende mais que a outra", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(7);
  // Região A paga 60, região B paga 30, com ruído.
  for (let i = 0; i < 200; i++) {
    const regiao = i % 2 ? "A" : "B";
    const y = (regiao === "A" ? 60 : 30) + (r() - 0.5) * 6;
    Mod.treinar(m, { quando: SEG + i * H, regiao }, y);
  }

  const a = Mod.prever(m, { quando: SEG, regiao: "A" });
  const b = Mod.prever(m, { quando: SEG, regiao: "B" });
  assert.ok(a.reaisPorHora > b.reaisPorHora + 15, `A=${a.reaisPorHora.toFixed(1)} B=${b.reaisPorHora.toFixed(1)}`);
  assert.ok(Math.abs(a.reaisPorHora - 60) < 8, `A deveria ficar perto de 60, veio ${a.reaisPorHora.toFixed(1)}`);
});

teste("aprende o efeito do horário, não só do lugar", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(11);
  // Mesma região: madrugada rende 25, tarde rende 55.
  for (let i = 0; i < 200; i++) {
    const madrugada = i % 2 === 0;
    const base = new Date(2026, 9, 5 + Math.floor(i / 2), madrugada ? 4 : 14, 0, 0).getTime();
    Mod.treinar(m, { quando: base, regiao: "A" }, (madrugada ? 25 : 55) + (r() - 0.5) * 5);
  }

  const noite = Mod.prever(m, { quando: new Date(2026, 10, 2, 4, 0, 0).getTime(), regiao: "A" });
  const tarde = Mod.prever(m, { quando: new Date(2026, 10, 2, 14, 0, 0).getTime(), regiao: "A" });
  assert.ok(tarde.reaisPorHora > noite.reaisPorHora + 10,
    `tarde=${tarde.reaisPorHora.toFixed(1)} madrugada=${noite.reaisPorHora.toFixed(1)}`);
});

teste("a incerteza encolhe conforme ele vive a situação", () => {
  const m = Mod.novoModelo();
  const antes = Mod.prever(m, { quando: SEG, regiao: "A" }).incerteza;
  for (let i = 0; i < 120; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "A" }, 45);
  const depois = Mod.prever(m, { quando: SEG, regiao: "A" }).incerteza;
  assert.ok(depois < antes / 2, `incerteza caiu de ${antes.toFixed(2)} para ${depois.toFixed(2)}`);
});

/* ---------------------------------------------------------- exploração */

teste("região nunca visitada é explorada mesmo rendendo menos na previsão", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 120; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "conhecida" }, 42);
  Mod.registrarRegiao(m, "nova");

  const ordem = Mod.escolher(m, [
    { quando: SEG, regiao: "conhecida" },
    { quando: SEG, regiao: "nova" },
  ]);
  const nova = ordem.find((o) => o.regiao === "nova");
  assert.ok(nova.incerteza > ordem.find((o) => o.regiao === "conhecida").incerteza,
    "a desconhecida tem que carregar mais incerteza");
  assert.equal(nova.explorando, true, "e ser marcada como exploração");
});

teste("depois de muito visitada, ela para de ser exploração", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 200; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "A" }, 42);
  const [a] = Mod.escolher(m, [{ quando: SEG, regiao: "A" }]);
  assert.equal(a.explorando, false, "o bônus de ignorância tem que acabar");
});

/* -------------------------------------------------- ele admite que não sabe */

teste("com pouco dado ele diz que não está pronto", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 5; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "A" }, 40);
  assert.equal(Mod.prever(m, { quando: SEG, regiao: "A" }).pronto, false);
  assert.equal(Mod.desempenho(m).pronto, false);
  assert.equal(Mod.resumo(m).agora, null, "sem base, nenhuma recomendação");
});

teste("EM DADO SEM PADRÃO, ele NÃO diz que aprendeu", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(29);
  // Puro ruído: não há o que aprender, e fingir que há seria o pior erro.
  for (let i = 0; i < 400; i++) {
    Mod.treinar(m, { quando: SEG + i * H, regiao: `c${i % 4}` }, 20 + r() * 40);
  }
  const d = Mod.desempenho(m);
  assert.equal(d.pronto, true, "avaliou o suficiente para ter opinião");
  assert.ok(d.ganhoPct < 8, `não pode alegar ganho real em ruído, alegou ${d.ganhoPct}%`);
});

teste("em dado COM padrão, ele bate o palpite burro", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(31);
  for (let i = 0; i < 400; i++) {
    const regiao = `c${i % 3}`;
    const base = { c0: 25, c1: 45, c2: 65 }[regiao];
    Mod.treinar(m, { quando: SEG + i * H, regiao }, base + (r() - 0.5) * 6);
  }
  const d = Mod.desempenho(m);
  assert.equal(d.melhorQueAMedia, true, "tem que errar menos que a média simples");
  assert.ok(d.ganhoPct > 40, `ganho de apenas ${d.ganhoPct}%`);
});

/* ------------------------------------------------- guardar e recarregar */

teste("guardar e recarregar não perde o que foi aprendido", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(13);
  for (let i = 0; i < 150; i++) {
    const regiao = i % 2 ? "A" : "B";
    Mod.treinar(m, { quando: SEG + i * H, regiao }, (regiao === "A" ? 60 : 30) + (r() - 0.5) * 4);
  }
  const antes = Mod.prever(m, { quando: SEG, regiao: "A" });
  const volta = Mod.desserializar(JSON.parse(JSON.stringify(Mod.serializar(m))));
  const depois = Mod.prever(volta, { quando: SEG, regiao: "A" });

  assert.ok(Math.abs(antes.reaisPorHora - depois.reaisPorHora) < 0.01, "a previsão tem que sobreviver");
  assert.equal(volta.n, m.n);
  assert.deepEqual(volta.regioes, m.regioes);
});

teste("modelo de formato antigo é descartado, não reaproveitado torto", () => {
  const velho = { versao: 1, d: 3, inversa: [1, 0, 0], b: [0, 0, 0], n: 900 };
  assert.equal(Mod.desserializar(velho).n, 0, "pesos de outro formato descrevem outro mundo");
  assert.equal(Mod.desserializar(null).n, 0);
});

/* ------------------------------------------------------------- resumo */

teste("enquanto erra mais que a média, o resumo NÃO manda previsão", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(53);
  // Ruído: não há padrão, então não pode haver recomendação.
  for (let i = 0; i < 300; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: `c${i % 4}` }, 20 + r() * 40);
  const res = Mod.resumo(m, SEG);
  assert.equal(res.desempenho.melhorQueAMedia, false);
  assert.equal(res.agora, null, "previsão junto de 'não sou confiável' convida a usá-la assim mesmo");
});

teste("o resumo é pequeno e não cresce com o histórico", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(17);
  for (let i = 0; i < 3000; i++) {
    const regiao = `c${i % 5}`;
    const base = 20 + Number(regiao.slice(1)) * 10;
    Mod.treinar(m, { quando: SEG + i * H, regiao }, base + (r() - 0.5) * 4);
  }
  const texto = JSON.stringify(Mod.resumo(m, SEG));
  assert.ok(texto.length < 900, `o resumo tem ${texto.length} caracteres — tem que caber em pouco`);
  assert.equal(JSON.parse(texto).observacoes, 3000, "mas sabe de quantas observações ele veio");
});

teste("o resumo não carrega coordenada", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 60; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "-1992:-4394" }, 45);
  const texto = JSON.stringify(Mod.resumo(m, SEG));
  assert.equal(texto.includes("-1992"), false, "a célula não pode sair no resumo");
});

/* --------------------------------------------- o que vira observação */

const trecho = (inicio, minutos, valor) => ({
  inicio, fim: inicio + minutos * 60000, ms: minutos * 60000, valor, periodo: "tarde",
});

teste("trecho curto demais não vira aprendizado", () => {
  const o = T.observacoesDe([trecho(SEG, 2, 5)], []);
  assert.equal(o.length, 0, "dois registros batidos seguidos não descrevem ritmo");
});

teste("R$/h impossível é erro de lançamento, não exemplo", () => {
  const o = T.observacoesDe([trecho(SEG, 10, 900)], []);
  assert.equal(o.length, 0, "5.400 R$/h não aconteceu");
});

teste("CADA TRECHO TREINA UMA VEZ — o marcador impede contar de novo", () => {
  const trechos = [trecho(SEG, 30, 25), trecho(SEG + 2 * H, 30, 25)];
  const todas = T.observacoesDe(trechos, []);
  assert.equal(todas.length, 2);

  // Simula uma segunda abertura do aplicativo, já tendo treinado o primeiro.
  const resto = T.observacoesDe(trechos, [], { ate: trechos[0].inicio });
  assert.equal(resto.length, 1, "abrir o app não pode reforçar a mesma noite");
  assert.equal(resto[0].quando, trechos[1].inicio);
});

teste("trecho sem rastro ainda ensina o horário", () => {
  const o = T.observacoesDe([trecho(SEG, 30, 25)], []);
  assert.equal(o.length, 1);
  assert.equal(o[0].regiao, null, "sem região, mas a hora continua valendo");
});

teste("a região vem do rastro daquele trecho", () => {
  const pontos = [
    { lat: -19.91, lon: -43.93, quando: SEG + 60000 },
    { lat: -19.91, lon: -43.93, quando: SEG + 120000 },
  ];
  const o = T.observacoesDe([trecho(SEG, 30, 25)], pontos);
  assert.ok(o[0].regiao, "a célula dominante virou a região");
});

teste("as observações saem em ordem de tempo", () => {
  const o = T.observacoesDe([trecho(SEG + 5 * H, 30, 25), trecho(SEG, 30, 25)], []);
  assert.ok(o[0].quando < o[1].quando, "treinar fora de ordem distorce o aprendizado");
});

teste("sem base, a tela não recebe recomendação", () => {
  const m = Mod.novoModelo();
  for (let i = 0; i < 8; i++) Mod.treinar(m, { quando: SEG + i * H, regiao: "A" }, 40);
  assert.equal(T.recomendacao(m, SEG), null, "cinco observações não autorizam recomendar");
});

teste("com base e ganho real, a recomendação sai sem coordenada", () => {
  const m = Mod.novoModelo();
  const r = aleatorio(41);
  for (let i = 0; i < 400; i++) {
    const regiao = i % 3 === 0 ? "-1992:-4394" : `c${i % 3}`;
    const base = regiao === "-1992:-4394" ? 70 : 30;
    Mod.treinar(m, { quando: SEG + i * H, regiao }, base + (r() - 0.5) * 5);
  }
  const rec = T.recomendacao(m, SEG);
  assert.ok(rec, "com padrão forte ele recomenda");
  assert.ok(/^região \d+$/.test(rec.regiao), "rótulo neutro");
  assert.equal(JSON.stringify({ regiao: rec.regiao, rh: rec.reaisPorHora }).includes("-1992"), false);
});

console.log(`✓ ${passou} testes passaram`);
