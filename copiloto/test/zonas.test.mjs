// Testes das zonas de risco por coordenada. node copiloto/test/zonas.test.mjs
import assert from "node:assert/strict";
import * as Z from "../js/zonas.js";

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

// Praça Sete, centro de Belo Horizonte.
const CENTRO = { lat: -19.9191, lon: -43.9386 };
const perto = (a, b, tol = 5) => Math.abs(a - b) <= tol;

/** Move um ponto N metros ao norte. Um grau de latitude ≈ 111.195 m. */
const aoNorte = (p, m) => ({ lat: p.lat + m / 111194.9, lon: p.lon });

const circulo = (raio, nivel = "atencao") =>
  Z.normalizarZona({ id: "c", nome: "Zona", tipo: "circulo", centro: CENTRO, raio, nivel });

/* ------------------------------------------------------------ geometria */

teste("distância bate com a realidade", () => {
  assert.ok(perto(Z.metrosEntre(CENTRO, aoNorte(CENTRO, 500)), 500), "500 m ao norte");
  assert.equal(Z.metrosEntre(CENTRO, CENTRO), 0);
});

teste("coordenada inválida não vira distância", () => {
  assert.equal(Z.metrosEntre(CENTRO, { lat: NaN, lon: 0 }), null);
  assert.equal(Z.metrosEntre(CENTRO, { lat: 120, lon: 0 }), null, "latitude fora do planeta");
});

teste("dentro e fora do círculo", () => {
  const z = circulo(300);
  assert.ok(Z.distanciaAteZona(CENTRO, z) < 0, "no centro está dentro");
  assert.ok(Z.distanciaAteZona(aoNorte(CENTRO, 200), z) < 0);
  assert.ok(Z.distanciaAteZona(aoNorte(CENTRO, 500), z) > 0, "500 m fora de um raio de 300");
});

teste("polígono: dentro, fora e sobre a borda", () => {
  const quadrado = Z.normalizarZona({
    nome: "Q", tipo: "poligono",
    pontos: [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.93 },
      { lat: -19.91, lon: -43.93 },
      { lat: -19.91, lon: -43.94 },
    ],
  });
  assert.ok(Z.dentroDoPoligono({ lat: -19.915, lon: -43.935 }, quadrado.pontos), "meio do quadrado");
  assert.equal(Z.dentroDoPoligono({ lat: -19.90, lon: -43.935 }, quadrado.pontos), false, "ao norte");
  assert.equal(Z.dentroDoPoligono({ lat: -19.915, lon: -43.95 }, quadrado.pontos), false, "a oeste");
});

teste("polígono com menos de três pontos não fecha área", () => {
  assert.equal(Z.dentroDoPoligono(CENTRO, [CENTRO, aoNorte(CENTRO, 100)]), false);
});

/* ------------------------------------------------------------ avaliação */

teste("avaliar acha a zona em que ele está", () => {
  const r = Z.avaliar(CENTRO, [circulo(300)]);
  assert.equal(r.dentro, true);
  assert.equal(r.nome, "Zona");
});

teste("avisa a aproximação antes de entrar", () => {
  const z = circulo(300);
  const r = Z.avaliar(aoNorte(CENTRO, 500), [z]);
  assert.equal(r.dentro, false, "ainda está fora");
  assert.ok(perto(r.metros, 200, 10), `faltam ~200 m, veio ${r.metros}`);
});

teste("longe demais não dispara nada", () => {
  assert.equal(Z.avaliar(aoNorte(CENTRO, 3000), [circulo(300)]), null);
});

teste("dentro ganha de perto, mesmo que a de perto seja mais grave", () => {
  const dentro = Z.normalizarZona({ id: "a", nome: "Estou aqui", tipo: "circulo", centro: CENTRO, raio: 300, nivel: "atencao" });
  const pertinho = Z.normalizarZona({ id: "b", nome: "Logo ali", tipo: "circulo", centro: aoNorte(CENTRO, 600), raio: 300, nivel: "evitar" });
  const r = Z.avaliar(CENTRO, [dentro, pertinho]);
  assert.equal(r.nome, "Estou aqui", "onde ele JÁ está é o que muda a decisão agora");
});

teste("entre duas em que ele está, a mais grave", () => {
  const a = Z.normalizarZona({ id: "a", nome: "Leve", tipo: "circulo", centro: CENTRO, raio: 400, nivel: "atencao" });
  const b = Z.normalizarZona({ id: "b", nome: "Pesada", tipo: "circulo", centro: CENTRO, raio: 300, nivel: "evitar" });
  assert.equal(Z.avaliar(CENTRO, [a, b]).nome, "Pesada");
});

teste("zona desligada não dispara", () => {
  const z = { ...circulo(300), ativa: false };
  assert.equal(Z.avaliar(CENTRO, [z]), null);
});

teste("sem GPS não existe veredito de zona", () => {
  assert.equal(Z.avaliar(null, [circulo(300)]), null);
  assert.equal(Z.avaliar({ lat: NaN, lon: NaN }, [circulo(300)]), null);
});

/* -------------------------------------------------------------- guardar */

teste("raio é preso entre o mínimo e o máximo", () => {
  assert.equal(circulo(10).raio, Z.RAIO_MINIMO_M, "abaixo do mínimo o GPS urbano não distingue");
  assert.equal(circulo(99999).raio, Z.RAIO_MAXIMO_M);
});

teste("polígono incompleto vira círculo em vez de zona que nunca dispara", () => {
  const z = Z.normalizarZona({ nome: "X", tipo: "poligono", pontos: [CENTRO, aoNorte(CENTRO, 100)] });
  assert.equal(z.tipo, "circulo");
  assert.deepEqual(z.centro, CENTRO);
});

teste("zona sem desenho E sem nome não serve para nada", () => {
  const vazia = Z.normalizarZona({ nome: "X", tipo: "circulo", centro: null });
  assert.equal(Z.zonaUtil(vazia), false);
  assert.equal(Z.paraOServico([vazia]).length, 0);
});

teste("zona só com nome ainda vale — é a única que alcança o destino", () => {
  const soNome = Z.normalizarZona({ nome: "X", termos: ["Morro do Papagaio"] });
  assert.equal(Z.temGeometria(soNome), false);
  assert.equal(Z.zonaUtil(soNome), true);
  const saida = Z.paraOServico([soNome]);
  assert.equal(saida[0].tipo, "nome");
  assert.deepEqual(saida[0].termos, ["morro do papagaio"], "normalizado aqui, não no Java");
});

teste("zona só com desenho não precisa de nome", () => {
  const soDesenho = Z.normalizarZona({ nome: "Y", tipo: "circulo", centro: CENTRO, raio: 300 });
  assert.equal(Z.zonaUtil(soDesenho), true);
  assert.deepEqual(Z.paraOServico([soDesenho])[0].termos, []);
});

teste("termo curto não sobrevive até o serviço", () => {
  const z = Z.normalizarZona({ nome: "X", tipo: "circulo", centro: CENTRO, raio: 300, termos: ["ab", "Vila Nova"] });
  assert.deepEqual(Z.paraOServico([z])[0].termos, ["vila nova"]);
});

teste("paraOServico entrega a geometria achatada", () => {
  const saida = Z.paraOServico([circulo(300, "evitar")]);
  assert.equal(saida[0].tipo, "circulo");
  assert.equal(saida[0].raio, 300);
  assert.equal(saida[0].nivel, "evitar");
  assert.ok(Number.isFinite(saida[0].lat) && Number.isFinite(saida[0].lon));
});

/* --------------------------------------------------------------- desenho */

teste("caixa cobre tudo e abre janela mínima num ponto só", () => {
  const c = Z.caixaDe([CENTRO]);
  assert.ok(c.maxLat > c.minLat && c.maxLon > c.minLon, "ponto único ainda tem extensão");
  assert.ok(c.minLat < CENTRO.lat && c.maxLat > CENTRO.lat);
});

teste("coordenada vira pixel e volta", () => {
  const caixa = Z.caixaDe([CENTRO, aoNorte(CENTRO, 1000)]);
  const tela = Z.paraTela(CENTRO, caixa, 300, 300);
  const volta = Z.daTela(tela.x, tela.y, caixa, 300, 300);
  assert.ok(Math.abs(volta.lat - CENTRO.lat) < 1e-6, "ida e volta têm que fechar");
  assert.ok(Math.abs(volta.lon - CENTRO.lon) < 1e-6);
});

teste("norte fica em cima na tela", () => {
  const caixa = Z.caixaDe([CENTRO, aoNorte(CENTRO, 1000)]);
  const sul = Z.paraTela(CENTRO, caixa, 300, 300);
  const norte = Z.paraTela(aoNorte(CENTRO, 1000), caixa, 300, 300);
  assert.ok(norte.y < sul.y, "y cresce para baixo, então o norte tem y menor");
});

teste("caixa sem ponto nenhum é nula, não uma caixa inventada", () => {
  assert.equal(Z.caixaDe([]), null);
  assert.equal(Z.caixaDe([{ lat: NaN, lon: 1 }]), null);
});

console.log(`✓ ${passou} testes passaram`);
