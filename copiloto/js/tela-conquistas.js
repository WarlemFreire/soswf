// tela-conquistas.js — ofensiva, troféus e estante de medalhas.
//
// Esta é a única tela do app que pode ser enfeitada: ninguém abre a estante de
// medalhas dirigindo. As outras seguem austeras de propósito.

import { el, limpar, abrirFolha } from "./ui.js";
import * as M from "./metrics.js";
import * as C from "./conquistas.js";
import * as store from "./store.js";
import { db } from "./db.js";
import { defsDeArte, arteMedalha, arteTrofeu } from "./arte.js";
import { progresso, formatarXp } from "./progresso.js";

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
  raiz.append(blocoNivel(progresso(avaliadas, est)));
  raiz.append(blocoEmAndamento(C.proximas(avaliadas, 3)));
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

/* ------------------------------------------------------ nível e andamento */

function blocoNivel({ nivel, moedas }) {
  return el(
    "section",
    { class: "conq__secao" },
    el(
      "div",
      { class: "nivel" },
      el(
        "div",
        { class: "nivel__linha" },
        el("span", { class: "nivel__selo" }, String(nivel.nivel)),
        el(
          "div",
          { class: "nivel__texto" },
          el("strong", {}, `Nível ${nivel.nivel}`),
          el("span", {}, `${formatarXp(nivel.faltam)} XP para o nível ${nivel.nivel + 1}`)
        ),
        el("div", { class: "nivel__moedas" }, el("span", { "aria-hidden": "true" }, "🪙"), el("strong", {}, formatarXp(moedas)))
      ),
      el("div", { class: "nivel__trilha" }, el("div", { class: "nivel__marca", style: { width: `${Math.round(nivel.progresso * 100)}%` } }))
    )
  );
}

/**
 * As três missões mais perto de cumprir. É o laço central do jogo: sair de
 * casa hoje sabendo exatamente o que dá para fechar.
 */
function blocoEmAndamento(missoes) {
  if (!missoes.length) return el("div");
  return el(
    "section",
    { class: "conq__secao" },
    cabecalho("Missões em andamento", null),
    el(
      "div",
      { class: "missoes" },
      ...missoes.map((m) =>
        el(
          "article",
          { class: "missao" },
          arteMedalha(m, { tamanho: 56 }),
          el(
            "div",
            { class: "missao__corpo" },
            el("strong", { class: "missao__objetivo" }, m.descricao),
            el("div", { class: "missao__trilha" }, el("div", { class: "missao__marca", style: { width: `${Math.max(2, Math.round(m.progresso * 100))}%` } })),
            el(
              "div",
              { class: "missao__pe" },
              el("span", { class: "missao__falta" }, m.texto ? `${m.texto} de ${m.textoAlvo}` : `${Math.round(m.progresso * 100)}%`),
              el("span", { class: "missao__premio" }, `+${m.xp} XP`)
            )
          )
        )
      )
    )
  );
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
    cabecalho("Quadro de missões", `${resumo.conquistadas} cumpridas`),
    el(
      "div",
      { class: "placar" },
      el(
        "div",
        { class: "placar__linha" },
        el("strong", { class: "placar__valor" }, String(resumo.conquistadas)),
        el("span", { class: "placar__total" }, `de ${resumo.total} missões`)
      ),
      el("div", { class: "placar__trilha" }, el("div", { class: "placar__marca", style: { width: `${Math.max(1, pct)}%` } })),
      el("span", { class: "placar__pct" }, `faltam ${resumo.restantes}`)
    ),
    el(
      "div",
      { class: "estante" },
      ...familias.map((f) => celaDaFamilia(f))
    )
  );
}

/**
 * Contagem sem número: uma conta por degrau, acesa se cumprido. Numa família
 * grande demais para caber em contas, uma barra. Fração escrita volta a ter
 * cara de planilha, que é justamente o que esta tela não pode ter.
 */
function marcadorDeFamilia(f) {
  if (f.total <= 10) {
    return el(
      "span",
      { class: "estante__contas", "aria-label": `${f.conquistadas} de ${f.total} cumpridas` },
      ...f.medalhas.map((m) => el("span", { class: `conta ${m.conquistada ? "conta--acesa" : ""}`.trim() }))
    );
  }
  return el(
    "span",
    { class: "estante__barra", "aria-label": `${f.conquistadas} de ${f.total} cumpridas` },
    el("span", { style: { width: `${Math.round((f.conquistadas / f.total) * 100)}%` } })
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
    f.conquistadas === f.total
      ? el("span", { class: "estante__completa" }, "COMPLETA")
      : marcadorDeFamilia(f)
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
            el(
              "div",
              { class: "degrau__topo" },
              el(
                "span",
                { class: `degrau__estado ${m.conquistada ? "degrau__estado--ok" : ""}`.trim() },
                m.conquistada ? "✓ CUMPRIDA" : "A CUMPRIR"
              ),
              el("span", { class: "degrau__premio" }, `+${m.xp} XP`)
            ),
            el("strong", {}, m.nome),
            el("span", { class: "degrau__descricao" }, m.descricao),
            m.conquistada
              ? el("span", { class: "degrau__selo" }, `${C.nomeDaPatente(m.patente)}`)
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
