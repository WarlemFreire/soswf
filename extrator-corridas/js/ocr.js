// ocr.js — le o texto de um print.
//
// Dois caminhos, nesta ordem:
//   1. TextDetector, o OCR do proprio Android. Instantaneo, sem baixar nada,
//      mas so existe no Chrome com a flag de recursos experimentais ligada.
//   2. Tesseract.js, baixado na hora. Funciona em qualquer navegador, mas sao
//      uns 8 MB no primeiro print (depois fica no cache) e demora uns segundos
//      por imagem.
//
// O texto sai linha por linha, na ordem de cima pra baixo, que é o que o
// parser espera.

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const IDIOMA = "por";

// Para rodar sem internet nenhuma: baixe o tesseract.js e o por.traineddata.gz,
// ponha ao lado da pagina e declare os caminhos antes de carregar o app:
//   <script>window.EXTRATOR_OCR = { script: "vendor/tesseract.min.js",
//     workerPath: "vendor/worker.min.js", corePath: "vendor/",
//     langPath: "vendor/lang" };</script>
const local = () => globalThis.EXTRATOR_OCR ?? {};

// Print de celular ja vem com 1080 de largura ou mais, e nesse tamanho o
// Tesseract le melhor do jeito que esta: testado no print de verdade, esticar
// pra 1600 fazia "0:32" virar "0:39". So imagem pequena é aumentada.
const LARGURA_MINIMA = 1000;
const LARGURA_ALVO = 1100;

let workerPromise = null;

export function temOcrDoAndroid() {
  return typeof globalThis.TextDetector === "function";
}

/* -------------------------------------------------------------- imagem */

async function paraCanvas(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = bitmap.width < LARGURA_MINIMA ? LARGURA_ALVO / bitmap.width : 1;
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();
  return canvas;
}

/* ------------------------------------------------- OCR do proprio Android */

/** Blocos soltos viram linhas: mesma altura = mesma linha, depois ordena. */
function blocosParaTexto(blocos, tolerancia = 14) {
  const itens = blocos
    .map((b) => ({
      texto: b.rawValue.trim(),
      y: b.boundingBox.y,
      x: b.boundingBox.x,
      altura: b.boundingBox.height,
    }))
    .filter((i) => i.texto)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const linhas = [];
  for (const item of itens) {
    const atual = linhas[linhas.length - 1];
    const limite = Math.max(tolerancia, item.altura * 0.6);
    if (atual && Math.abs(item.y - atual.y) <= limite) {
      atual.itens.push(item);
    } else {
      linhas.push({ y: item.y, itens: [item] });
    }
  }
  return linhas
    .map((l) => l.itens.sort((a, b) => a.x - b.x).map((i) => i.texto).join(" "))
    .join("\n");
}

async function lerComAndroid(canvas) {
  const blocos = await new globalThis.TextDetector().detect(canvas);
  return blocosParaTexto(blocos);
}

/* ---------------------------------------------------------- Tesseract.js */

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error("nao consegui baixar o motor de OCR"));
    document.head.append(tag);
  });
}

async function obterWorker(aoProgredir) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const vendor = local();
    if (!globalThis.Tesseract) await carregarScript(vendor.script ?? TESSERACT_CDN);
    const opcoes = {
      logger: (m) => {
        if (m.status === "recognizing text") return; // esse vem do recognize
        aoProgredir?.({ etapa: m.status, fracao: m.progress ?? 0 });
      },
    };
    if (vendor.workerPath) opcoes.workerPath = vendor.workerPath;
    if (vendor.corePath) opcoes.corePath = vendor.corePath;
    if (vendor.langPath) Object.assign(opcoes, { langPath: vendor.langPath, gzip: true });
    return globalThis.Tesseract.createWorker(IDIOMA, 1, opcoes);
  })();
  return workerPromise;
}

async function lerComTesseract(canvas, { modo = "6", aoProgredir } = {}) {
  const worker = await obterWorker(aoProgredir);
  await worker.setParameters({ tessedit_pageseg_mode: String(modo) });
  const { data } = await worker.recognize(canvas);
  return data.text;
}

export async function encerrar() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate?.();
}

/* ---------------------------------------------------------------- fachada */

/**
 * Le um print e devolve `{ texto, motor }`.
 * `motor` diz quem leu, porque a qualidade muda bastante entre os dois.
 */
export async function lerImagem(arquivo, { forcarTesseract = false, modo = "6", aoProgredir } = {}) {
  const canvas = await paraCanvas(arquivo);
  if (!forcarTesseract && temOcrDoAndroid()) {
    try {
      const texto = await lerComAndroid(canvas);
      if (texto.trim()) return { texto, motor: "android" };
    } catch {
      // Sem drama: cai pro Tesseract.
    }
  }
  const texto = await lerComTesseract(canvas, { modo, aoProgredir });
  return { texto, motor: "tesseract" };
}
