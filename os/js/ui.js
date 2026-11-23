// ui.js — helpers de DOM, sem framework (o repo nao tem build step).

export function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    node.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return node;
}

export function limpar(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

let toastTimer = null;
export function toast(msg, tipo = "") {
  const area = document.getElementById("toast");
  area.textContent = msg;
  area.className = `toast toast--visivel ${tipo ? "toast--" + tipo : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (area.className = "toast"), 4000);
}

export function dataHora(ts) {
  return ts ? new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function moeda(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
}

export function mmss(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
