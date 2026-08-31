// ui.js — helpers de DOM. Nada de framework: o app é pequeno, offline e o repo
// nao tem build step.

import { fecharToast } from "./feedback.js";
import { empilharFolha, desempilhar, ligarFolhas } from "./navegacao.js";

export function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor == null || valor === false) continue;
    if (chave === "class") node.className = valor;
    else if (chave === "dataset") Object.assign(node.dataset, valor);
    else if (chave === "style") Object.assign(node.style, valor);
    else if (chave.startsWith("on") && typeof valor === "function") {
      node.addEventListener(chave.slice(2).toLowerCase(), valor);
    } else if (chave === "html") node.innerHTML = valor;
    else if (chave in node && chave !== "list") node[chave] = valor;
    else node.setAttribute(chave, String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho == null || filho === false) continue;
    node.append(filho.nodeType ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

export function limpar(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}


const pilhaDeFolhas = [];

// O voltar do sistema fecha a folha do topo, se houver uma.
ligarFolhas(() => {
  const topo = pilhaDeFolhas.at(-1);
  if (!topo) return false;
  topo.fecharPorHistorico();
  return true;
});

/**
 * Folha deslizante (bottom sheet). Fecha no fundo, no ✕ e no Esc.
 *
 * As folhas empilham em vez de se substituir: quando o registro pergunta algo
 * (o saldo caiu), a folha de registro fica esperando por baixo com os valores
 * ja digitados, em vez de ser destruida.
 */
export function abrirFolha({ titulo, conteudo, rodape, classe = "", aoFechar }) {
  fecharToast();
  empilharFolha();
  pilhaDeFolhas.at(-1)?.fundo.classList.add("folha-fundo--atras");

  const corpo = el("div", { class: "folha__corpo" });
  // O rodape fica fora da area rolavel: o botao de acao nunca pode ficar
  // escondido abaixo da dobra num app que se usa dirigindo.
  const pe = rodape ? el("footer", { class: "folha__pe" }) : null;
  const folha = el(
    "div",
    { class: `folha ${classe}`.trim(), role: "dialog", "aria-modal": "true", "aria-label": titulo || "" },
    el(
      "header",
      { class: "folha__topo" },
      el("h2", { class: "folha__titulo" }, titulo || ""),
      el("button", { type: "button", class: "folha__fechar", "aria-label": "Fechar", onClick: fechar }, "✕")
    ),
    corpo,
    pe
  );
  const fundo = el(
    "div",
    { class: "folha-fundo", onClick: (ev) => ev.target === fundo && noTopo() && fechar() },
    folha
  );

  const noTopo = () => pilhaDeFolhas.at(-1)?.fundo === fundo;

  function fechar({ doHistorico = false } = {}) {
    document.removeEventListener("keydown", aoTeclar);
    const indice = pilhaDeFolhas.findIndex((f) => f.fundo === fundo);
    if (indice >= 0) pilhaDeFolhas.splice(indice, 1);
    fundo.remove();
    pilhaDeFolhas.at(-1)?.fundo.classList.remove("folha-fundo--atras");
    // Fechada pelo ✕, pelo fundo ou por código: a entrada de histórico que
    // abrimos precisa sair junto, senão o voltar vira toque sem efeito.
    if (!doHistorico) desempilhar();
    aoFechar?.();
  }
  function aoTeclar(ev) {
    if (ev.key === "Escape" && noTopo()) fechar();
  }
  document.addEventListener("keydown", aoTeclar);

  const api = { fechar: () => fechar(), corpo, folha };
  pilhaDeFolhas.push({ fundo, api, fecharPorHistorico: () => fechar({ doHistorico: true }) });
  corpo.append(...[].concat(typeof conteudo === "function" ? conteudo(api) : conteudo).filter(Boolean));
  if (pe) pe.append(...[].concat(typeof rodape === "function" ? rodape(api) : rodape).filter(Boolean));
  document.body.append(fundo);
  requestAnimationFrame(() => folha.classList.add("folha--aberta"));
  return api;
}

/** Linha de chips de escolha unica. */
export function chips(opcoes, { selecionado, aoEscolher, classe = "" } = {}) {
  const linha = el("div", { class: `chips ${classe}`.trim() });
  for (const opcao of opcoes) {
    const botao = el(
      "button",
      {
        type: "button",
        class: `chip ${opcao.id === selecionado ? "chip--ativo" : ""}`.trim(),
        dataset: { id: opcao.id },
        onClick: () => {
          for (const outro of linha.children) outro.classList.remove("chip--ativo");
          botao.classList.add("chip--ativo");
          if (navigator.vibrate) navigator.vibrate(8);
          aoEscolher?.(opcao.id, opcao);
        },
      },
      opcao.icone ? el("span", { class: "chip__icone" }, opcao.icone) : null,
      el("span", {}, opcao.nome)
    );
    linha.append(botao);
  }
  return linha;
}

export function trocarTela(id) {
  for (const tela of document.querySelectorAll(".tela")) {
    tela.classList.toggle("tela--ativa", tela.id === `tela-${id}`);
  }
  for (const aba of document.querySelectorAll(".rodape__item")) {
    aba.classList.toggle("rodape__item--ativo", aba.dataset.tela === id);
  }
  document.querySelector(".conteudo")?.scrollTo(0, 0);
}
