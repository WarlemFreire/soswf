// app.js — a tela do extrator. Junta o OCR com o parser e deixa o motorista
// conferir e corrigir antes de exportar. Nada sai do aparelho: o OCR roda no
// proprio navegador e o CSV é baixado, nao enviado.

import { COLUNAS, extrair, paraCsv, totais } from "./parser.js";
import { encerrar, lerImagem, temOcrDoAndroid } from "./ocr.js";

const $ = (sel) => document.querySelector(sel);
const CHAVE = "extrator-corridas";

const RECADO = {
  texto: "Lido do texto do macro: esse caminho não erra número nenhum.",
  android: "Lido com o OCR do próprio Android.",
  tesseract: "Lido com o Tesseract. Confira as horas: é o que ele mais erra.",
};

const estado = {
  arquivos: [],
  textos: [],
  corridas: [],
  lendo: false,
};

/* ------------------------------------------------------------ guardado */

function guardar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ corridas: estado.corridas, textos: estado.textos }));
  } catch {
    // Sem espaço: o dado na tela continua valendo, so nao sobrevive a recarga.
  }
}

function recuperar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (salvo?.corridas?.length) {
      estado.corridas = salvo.corridas;
      estado.textos = salvo.textos ?? [];
      return true;
    }
  } catch {
    /* ignora */
  }
  return false;
}

/* -------------------------------------------------------------- leitura */

function aviso(texto, tipo = "") {
  const el = $("#aviso");
  el.textContent = texto;
  el.className = `aviso ${tipo}`.trim();
  el.hidden = !texto;
}

function progresso(feito, total, detalhe = "") {
  const barra = $("#progresso");
  barra.hidden = false;
  barra.querySelector("progress").value = total ? feito / total : 0;
  barra.querySelector("span").textContent = detalhe || `print ${feito} de ${total}`;
}

const ehTexto = (arquivo) =>
  /^text\//.test(arquivo.type) || /\.(txt|csv)$/i.test(arquivo.name);

async function lerPrints() {
  if (estado.lendo || !estado.arquivos.length) return;
  estado.lendo = true;
  $("#ler").disabled = true;
  aviso("");

  const modo = $("#modo").value;
  const forcarTesseract = $("#motor").value === "tesseract";
  const textos = [];
  const motores = new Set();

  try {
    for (const [i, arquivo] of estado.arquivos.entries()) {
      progresso(i, estado.arquivos.length);
      // Arquivo de texto vem do macro lendo a tela: nao precisa de OCR nenhum,
      // e esse caminho nao erra numero.
      if (ehTexto(arquivo)) {
        textos.push(await arquivo.text());
        motores.add("texto");
        continue;
      }
      const { texto, motor } = await lerImagem(arquivo, {
        modo,
        forcarTesseract,
        aoProgredir: ({ etapa, fracao }) =>
          progresso(i, estado.arquivos.length, `preparando o OCR: ${Math.round(fracao * 100)}% (${etapa})`),
      });
      textos.push(texto);
      motores.add(motor);
    }
    progresso(estado.arquivos.length, estado.arquivos.length, "juntando as corridas");
    aplicarTextos(textos);
    // Misturou os caminhos: vale o recado do mais fraco, que é o que precisa
    // de conferencia.
    const pior = ["tesseract", "android", "texto"].find((m) => motores.has(m));
    aviso(RECADO[pior] ?? RECADO.tesseract, "ok");
  } catch (erro) {
    aviso(`Nao consegui ler: ${erro.message}`, "ruim");
  } finally {
    await encerrar();
    estado.lendo = false;
    $("#ler").disabled = false;
    $("#progresso").hidden = true;
  }
}

function aplicarTextos(textos) {
  estado.textos = textos;
  const r = extrair(textos);
  estado.corridas = r.corridas;
  guardar();
  desenhar(r);
}

/* ------------------------------------------------------------- desenho */

const brl = (v) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Numero com virgula, que é como se escreve aqui. */
const num = (v, casas = 2) =>
  v == null ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas });

function desenhar(resumo = null) {
  const t = totais(estado.corridas);
  $("#resultado").hidden = estado.corridas.length === 0;
  $("#vazio").hidden = estado.corridas.length > 0;

  $("#totais").innerHTML = [
    ["corridas", t.quantidade],
    ["ganho", brl(t.valor)],
    ["km", t.distanciaKm ? num(t.distanciaKm) : "—"],
    ["canceladas", t.canceladas],
  ]
    .map(([rotulo, valor]) => `<div class="ficha"><b>${valor}</b><span>${rotulo}</span></div>`)
    .join("");

  $("#porDia").innerHTML = t.porDia
    .map((d) => `<li><span>${rotuloData(d.data)}</span><b>${brl(d.valor)}</b><small>${d.corridas} corridas</small></li>`)
    .join("");

  if (resumo) {
    const partes = [];
    if (resumo.repetidas) partes.push(`${resumo.repetidas} repetidas juntadas`);
    if (resumo.ignoradas.length) partes.push(`${resumo.ignoradas.length} linhas de total ignoradas`);
    $("#detalhe").textContent = partes.join(" · ");
  }

  $("#lista").innerHTML = estado.corridas.map(cartao).join("");
}

function rotuloData(iso) {
  if (!iso || iso === "sem data") return "sem data";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const minutos = (seg) => (seg == null ? "" : Math.round(seg / 60));

function esc(v) {
  return String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
}

function cartao(c, i) {
  const trajeto = [c.bairroOrigem, c.bairroDestino].filter(Boolean).join(" → ");
  const medidas = [
    c.distanciaKm != null ? `${num(c.distanciaKm)} km` : null,
    c.duracaoSeg != null ? `${minutos(c.duracaoSeg)} min` : null,
    c.status,
  ].filter(Boolean);
  const faltando = !c.data || c.valor == null;

  return `<article class="cartao${faltando ? " cartao--atencao" : ""}">
    <header>
      <b>${brl(c.valor)}</b>
      <span>${rotuloData(c.data)} ${esc(c.hora ?? "")}</span>
    </header>
    <p class="cartao__linha">${esc(c.tipo ?? "tipo?")}${medidas.length ? " · " + esc(medidas.join(" · ")) : ""}</p>
    ${trajeto ? `<p class="cartao__trajeto">${esc(trajeto)}</p>` : ""}
    <details>
      <summary>corrigir</summary>
      <div class="campos">
        ${campo(i, "data", "data", c.data, "date")}
        ${campo(i, "hora", "hora", c.hora, "time")}
        ${campo(i, "valor", "valor", c.valor, "number")}
        ${campo(i, "tipo", "tipo", c.tipo, "text")}
        ${campo(i, "distanciaKm", "km", c.distanciaKm, "number")}
        ${campo(i, "duracaoSeg", "minutos", minutos(c.duracaoSeg), "number")}
        ${campo(i, "bairroOrigem", "bairro origem", c.bairroOrigem, "text")}
        ${campo(i, "bairroDestino", "bairro destino", c.bairroDestino, "text")}
        ${campo(i, "status", "status", c.status, "text")}
        ${campo(i, "dinamico", "dinâmico", typeof c.dinamico === "number" ? c.dinamico : null, "number")}
      </div>
      <p class="bruto">${esc(c.textoBruto)}</p>
      <button type="button" class="apagar" data-apagar="${i}">Apagar esta corrida</button>
    </details>
  </article>`;
}

function campo(i, nome, rotulo, valor, tipo) {
  const passo = tipo === "number" ? ' step="0.01"' : "";
  return `<label><span>${rotulo}</span>
    <input type="${tipo}"${passo} value="${esc(valor ?? "")}" data-i="${i}" data-campo="${nome}" />
  </label>`;
}

/* --------------------------------------------------------------- saida */

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------- eventos */

function ligar() {
  $("#arquivos").addEventListener("change", (e) => {
    estado.arquivos = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
    $("#escolhidos").textContent = estado.arquivos.length
      ? `${estado.arquivos.length} print(s) escolhido(s)`
      : "";
    $("#ler").disabled = estado.arquivos.length === 0;
  });

  $("#ler").addEventListener("click", lerPrints);

  $("#usarTexto").addEventListener("click", () => {
    const texto = $("#texto").value.trim();
    if (!texto) return aviso("Cole o texto primeiro.", "ruim");
    // Uma linha em branco separa um print do outro.
    aplicarTextos(texto.split(/\n\s*\n\s*\n/));
    aviso("Texto lido sem OCR: esse caminho nao erra nenhum numero.", "ok");
  });

  $("#lista").addEventListener("input", (e) => {
    const alvo = e.target;
    if (!alvo.dataset?.campo) return;
    const corrida = estado.corridas[Number(alvo.dataset.i)];
    if (!corrida) return;
    const campo = alvo.dataset.campo;
    const bruto = alvo.value.trim();

    if (campo === "duracaoSeg") corrida.duracaoSeg = bruto ? Math.round(Number(bruto) * 60) : null;
    else if (alvo.type === "number") corrida[campo] = bruto ? Number(bruto.replace(",", ".")) : null;
    else corrida[campo] = bruto || null;

    guardar();
    desenharTotais();
  });

  $("#lista").addEventListener("click", (e) => {
    const i = e.target.dataset?.apagar;
    if (i === undefined) return;
    estado.corridas.splice(Number(i), 1);
    guardar();
    desenhar();
  });

  $("#csv").addEventListener("click", () => {
    if (!estado.corridas.length) return;
    baixar(`corridas-${carimbo()}.csv`, paraCsv(estado.corridas), "text/csv");
  });

  $("#json").addEventListener("click", () => {
    if (!estado.corridas.length) return;
    const pacote = {
      app: "extrator-corridas",
      versao: 1,
      extraidoEm: new Date().toISOString(),
      colunas: COLUNAS.map(([campo]) => campo),
      corridas: estado.corridas,
    };
    baixar(`corridas-${carimbo()}.json`, JSON.stringify(pacote, null, 2), "application/json");
  });

  $("#verTexto").addEventListener("click", () => {
    const caixa = $("#textoLido");
    caixa.hidden = !caixa.hidden;
    caixa.value = estado.textos.join("\n\n\n");
  });

  $("#limpar").addEventListener("click", () => {
    if (estado.corridas.length && !confirm("Apagar tudo que esta na tela?")) return;
    estado.corridas = [];
    estado.textos = [];
    estado.arquivos = [];
    $("#arquivos").value = "";
    $("#escolhidos").textContent = "";
    localStorage.removeItem(CHAVE);
    desenhar();
    aviso("");
  });
}

function desenharTotais() {
  const t = totais(estado.corridas);
  $("#totais").querySelectorAll("b")[1].textContent = brl(t.valor);
  $("#totais").querySelectorAll("b")[0].textContent = t.quantidade;
}

/* ------------------------------------------------- veio do compartilhar */

/**
 * O Android entregou os prints pro service worker, que guardou num cache e
 * mandou a pagina abrir com ?compartilhado=N. Aqui a gente pega de volta e ja
 * comeca a ler, sem o motorista procurar arquivo.
 */
async function pegarCompartilhados() {
  const quantos = Number(new URLSearchParams(location.search).get("compartilhado") || 0);
  if (!quantos) return false;
  history.replaceState(null, "", location.pathname);

  try {
    const cache = await caches.open("extrator-compartilhado");
    const chaves = (await cache.keys()).sort((a, b) => a.url.localeCompare(b.url));
    const arquivos = [];
    for (const chave of chaves) {
      const resposta = await cache.match(chave);
      if (!resposta) continue;
      const nome = decodeURIComponent(resposta.headers.get("x-nome") || "print.png");
      const tipo = resposta.headers.get("content-type") || "image/png";
      arquivos.push(new File([await resposta.blob()], nome, { type: tipo }));
      await cache.delete(chave);
    }
    if (!arquivos.length) return false;
    estado.arquivos = arquivos.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
    $("#escolhidos").textContent = `${arquivos.length} print(s) recebido(s) do compartilhamento`;
    $("#ler").disabled = false;
    return true;
  } catch {
    aviso("Recebi o compartilhamento mas nao consegui abrir os arquivos.", "ruim");
    return false;
  }
}

/* --------------------------------------------------------------- inicio */

ligar();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Sem service worker o app continua funcionando; so nao da pra compartilhar
    // da galeria direto nem usar offline.
  });
}
$("#dicaMotor").textContent = temOcrDoAndroid()
  ? "Seu navegador tem OCR nativo: a leitura vai ser instantânea."
  : "Seu navegador não tem OCR nativo: vai usar o Tesseract (baixa ~8 MB na primeira vez).";
desenhar();
pegarCompartilhados().then((veio) => {
  if (veio) return lerPrints();
  if (recuperar()) {
    desenhar();
    aviso("Recuperei o que você tinha extraído antes.", "ok");
  }
});
