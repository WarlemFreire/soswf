// tela-conquistas.js — ofensiva, troféus e estante de medalhas.
//
// Esta é a única tela do app que pode ser enfeitada: ninguém abre a estante de
// medalhas dirigindo. As outras seguem austeras de propósito.

import { el, limpar, abrirFolha } from "./ui.js";
import * as M from "./metrics.js";
import * as C from "./conquistas.js";
import * as store from "./store.js";
import { db } from "./db.js";
import { defsDeArte, arteMedalha, arteTrofeu, patenteDe, nomeDaPatente } from "./arte.js";

const LETRAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const DIA_MS = 86400000;

export async function montarConquistas(raiz) {
  limpar(raiz);

  const resumos = await store.historico();
  // A jornada de hoje ainda aberta CONTA. Ver a chama apagada no meio do turno,
  // dirigindo, seria simplesmente falso — ele está trabalhando agora.
  const dias = store.agruparPorDia(resumos);
  const corridas = await db.todos("corridas");
  const custos = await db.todos("custos");

  const of = C.ofensiva(dias);
  const est = C.estatisticas({ dias, historico: resumos, corridas, custos });
  const avaliadas = C.avaliar(est);

  raiz.append(defsDeArte());
  raiz.append(blocoOfensiva(of, dias));
  raiz.append(blocoRecordes(C.recordes(dias, corridas, resumos)));
  raiz.append(blocoMedalhas(avaliadas));
}

/* --------------------------------------------------------------- ofensiva */

function blocoOfensiva(of, dias) {
  const trabalhados = new Set(dias.map((d) => d.data));
  const primeiroDaCorrente = of.diasNaCorrente[0] || null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const celulas = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * DIA_MS);
    const data = M.chaveData(d.getTime());
    let estado = "vazio";
    if (trabalhados.has(data)) estado = "cheio";
    // Hoje ainda está em aberto — marcar como folga seria dar o dia por perdido.
    else if (i === 0) estado = "hoje";
    // Folga dentro da corrente viva: nao é falta, é a folga que o app permite.
    else if (of.viva && primeiroDaCorrente && data > primeiroDaCorrente) estado = "folga";
    const marca = { cheio: "🔥", folga: "💤" }[estado] || "";
    celulas.push(
      el(
        "div",
        { class: `ofensiva__dia ofensiva__dia--${estado}`, title: i === 0 ? "hoje" : data },
        el("span", { class: "ofensiva__letra" }, LETRAS_SEMANA[d.getDay()]),
        el("span", { class: "ofensiva__marca", "aria-hidden": "true" }, marca)
      )
    );
  }

  return el(
    "section",
    { class: "conq__secao" },
    el(
      "div",
      { class: `ofensiva ${of.viva ? "" : "ofensiva--apagada"}`.trim() },
      el(
        "div",
        { class: "ofensiva__topo" },
        el("span", { class: "ofensiva__chama", "aria-hidden": "true" }, of.viva ? "🔥" : "🕯️"),
        el(
          "div",
          { class: "ofensiva__numeros" },
          el("strong", { class: "ofensiva__valor" }, String(of.atual)),
          el("span", { class: "ofensiva__unidade" }, of.atual === 1 ? "dia seguido" : "dias seguidos")
        )
      ),
      el("div", { class: "ofensiva__semana" }, ...celulas),
      el("p", { class: "ofensiva__estado" }, recadoOfensiva(of)),
      of.recorde > 0
        ? el("p", { class: "conq__nota" }, `Seu recorde de ofensiva é de ${of.recorde} ${of.recorde === 1 ? "dia" : "dias"}.`)
        : null
    )
  );
}

/**
 * O recado precisa dizer o que está em jogo HOJE. "Ofensiva de 12 dias" sem
 * dizer quanto falta para perdê-la nao ajuda ninguem a decidir se sai ou nao.
 */
function recadoOfensiva(of) {
  if (!of.ultimoDia) return "Abra uma jornada e a ofensiva começa hoje mesmo.";
  if (!of.viva) return `A ofensiva zerou. Rode hoje e ela recomeça — ${C.FOLGA_MAXIMA} dias de folga são permitidos.`;
  if (of.trabalhouHoje) return `Hoje já contou. Você tem ${C.FOLGA_MAXIMA} dias de folga guardados.`;
  if (of.folgasRestantes >= 2) return "Você pode folgar hoje e amanhã sem perder nada.";
  if (of.folgasRestantes === 1) return `Última folga. Se não rodar amanhã, a ofensiva de ${of.atual} zera.`;
  return `Hoje é o último dia. Sem jornada, a ofensiva de ${of.atual} zera.`;
}

/* --------------------------------------------------------------- recordes */

function blocoRecordes(lista) {
  const comValor = lista.filter((r) => r.valor);
  if (!comValor.length) return el("div");

  return el(
    "section",
    { class: "conq__secao" },
    cabecalho("Sala de troféus", `${comValor.length} recordes`),
    el(
      "div",
      { class: "trofeus" },
      ...comValor.map((r) =>
        el(
          "article",
          { class: "trofeu-cartao" },
          arteTrofeu({ tamanho: 50 }),
          el("strong", { class: "trofeu-cartao__valor" }, r.valor),
          el("span", { class: "trofeu-cartao__nome" }, r.nome),
          el("span", { class: "trofeu-cartao__quando" }, [M.formatarData(quando(r.quando)), r.detalhe].filter(Boolean).join(" · "))
        )
      )
    ),
    el("p", { class: "conq__nota" }, "Arraste para o lado para ver todos.")
  );
}

function quando(dataIso) {
  if (!dataIso) return Date.now();
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 12).getTime();
}

/* --------------------------------------------------------------- medalhas */

function blocoMedalhas(avaliadas) {
  const resumo = C.resumoMedalhas(avaliadas);
  const pct = Math.round((resumo.conquistadas / resumo.total) * 100);
  const familias = C.porFamilia(avaliadas).sort((a, b) => {
    // Famílias com progresso primeiro; as intocadas ficam no fim.
    const pa = a.conquistadas / a.total;
    const pb = b.conquistadas / b.total;
    if (pb !== pa) return pb - pa;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });

  return el(
    "section",
    { class: "conq__secao" },
    el(
      "div",
      { class: "placar" },
      el(
        "div",
        { class: "placar__linha" },
        el("strong", { class: "placar__valor" }, String(resumo.conquistadas)),
        el("span", { class: "placar__total" }, `de ${resumo.total} medalhas`)
      ),
      el("div", { class: "placar__trilha" }, el("div", { class: "placar__marca", style: { width: `${Math.max(1, pct)}%` } })),
      el("span", { class: "placar__pct" }, `${pct}% da coleção`)
    ),
    el(
      "div",
      { class: "estante" },
      ...familias.map((f) => celaDaFamilia(f))
    )
  );
}

/**
 * Cada família aparece pela medalha mais alta já conquistada — colorida, é o
 * troféu que ele ganhou. Sem nenhuma ainda, mostra a próxima em chumbo com o
 * anel de progresso, que é o convite.
 */
function celaDaFamilia(f) {
  const mostrar = f.atual || f.proxima || f.medalhas[0];
  return el(
    "button",
    { type: "button", class: "estante__cela", onClick: () => abrirFamilia(f) },
    arteMedalha(mostrar, { tamanho: 78 }),
    el("span", { class: "estante__nome" }, f.nome),
    el("span", { class: `estante__conta ${f.conquistadas === f.total ? "estante__conta--cheia" : ""}`.trim() },
      f.conquistadas === f.total ? "completa ✓" : `${f.conquistadas}/${f.total}`)
  );
}

function abrirFamilia(familia) {
  abrirFolha({
    titulo: familia.nome,
    classe: "folha--medalhas",
    conteudo: el(
      "div",
      { class: "degraus" },
      ...familia.medalhas.map((m) =>
        el(
          "div",
          { class: `degrau ${m.conquistada ? "degrau--ok" : ""}`.trim() },
          arteMedalha(m, { tamanho: 62 }),
          el(
            "div",
            { class: "degrau__texto" },
            el("strong", {}, m.nome),
            el("span", { class: "degrau__descricao" }, m.descricao),
            m.conquistada
              ? el("span", { class: "degrau__selo" }, `${nomeDaPatente(patenteDe(m))} · conquistada`)
              : el(
                  "span",
                  { class: "degrau__falta" },
                  m.texto ? `${m.texto} de ${m.textoAlvo}` : `${Math.round(m.progresso * 100)}%`
                )
          )
        )
      )
    ),
  });
}

/* -------------------------------------------------------------- estrutura */

function cabecalho(titulo, direita) {
  return el(
    "div",
    { class: "conq__cabecalho" },
    el("h2", { class: "conq__titulo" }, titulo),
    direita ? el("span", { class: "conq__contagem" }, direita) : null
  );
}
