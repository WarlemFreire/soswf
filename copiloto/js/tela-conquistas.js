// tela-conquistas.js — ofensiva, recordes e medalhas.
//
// A ordem da tela é proposital: primeiro a ofensiva (o que se perde hoje),
// depois o que está perto de cair (o que dá para buscar hoje), depois os
// recordes (o que já foi feito) e por último a estante de medalhas.

import { el, limpar, abrirFolha } from "./ui.js";
import * as M from "./metrics.js";
import * as C from "./conquistas.js";
import * as store from "./store.js";
import { db } from "./db.js";

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

  raiz.append(blocoOfensiva(of, dias));

  const perto = C.proximas(avaliadas, 4);
  if (perto.length) raiz.append(blocoProximas(perto));

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
  if (of.folgasRestantes >= 2) return `Você pode folgar hoje e amanhã sem perder nada.`;
  if (of.folgasRestantes === 1) return `Última folga. Se não rodar amanhã, a ofensiva de ${of.atual} zera.`;
  return `Hoje é o último dia. Sem jornada, a ofensiva de ${of.atual} zera.`;
}

/* --------------------------------------------------------------- próximas */

function blocoProximas(perto) {
  return secao(
    "Perto de cair",
    el(
      "div",
      { class: "conq__lista" },
      ...perto.map((m) =>
        el(
          "div",
          { class: "conq__perto" },
          el(
            "div",
            { class: "conq__perto-topo" },
            el("span", { class: "conq__icone", "aria-hidden": "true" }, m.icone),
            el(
              "div",
              { class: "conq__perto-texto" },
              el("strong", {}, m.nome),
              el("span", { class: "conq__descricao" }, m.texto ? `${m.texto} de ${m.textoAlvo}` : m.descricao)
            ),
            el("span", { class: "conq__pct" }, `${Math.round(m.progresso * 100)}%`)
          ),
          el("div", { class: "conq__trilha" }, el("div", { class: "conq__marca", style: { width: `${Math.round(m.progresso * 100)}%` } }))
        )
      )
    )
  );
}

/* --------------------------------------------------------------- recordes */

function blocoRecordes(lista) {
  const comValor = lista.filter((r) => r.valor);
  if (!comValor.length) return el("div");

  return secao(
    "Seus recordes",
    el(
      "div",
      { class: "conq__recordes" },
      ...comValor.map((r) =>
        el(
          "div",
          { class: "conq__recorde" },
          el("span", { class: "conq__recorde-nome" }, r.nome),
          el("strong", { class: "conq__recorde-valor" }, r.valor),
          el("span", { class: "conq__recorde-quando" }, [M.formatarData(quando(r.quando)), r.detalhe].filter(Boolean).join(" · "))
        )
      )
    )
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
  const familias = C.porFamilia(avaliadas).sort((a, b) => {
    // Famílias com progresso primeiro; as intocadas ficam no fim.
    const pa = a.conquistadas / a.total;
    const pb = b.conquistadas / b.total;
    if (pb !== pa) return pb - pa;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });

  return secao(
    `Medalhas · ${resumo.conquistadas} de ${resumo.total}`,
    el(
      "div",
      { class: "conq__familias" },
      ...familias.map((f) =>
        el(
          "button",
          { type: "button", class: `conq__familia ${f.conquistadas ? "" : "conq__familia--zerada"}`.trim(), onClick: () => abrirFamilia(f) },
          el("span", { class: "conq__icone", "aria-hidden": "true" }, f.icone),
          el(
            "span",
            { class: "conq__familia-texto" },
            el("strong", {}, f.nome),
            el("span", { class: "conq__descricao" }, f.atual ? f.atual.nome : f.proxima ? `Falta: ${f.proxima.textoAlvo || f.proxima.nome}` : "")
          ),
          el("span", { class: "conq__contagem" }, `${f.conquistadas}/${f.total}`)
        )
      )
    )
  );
}

function abrirFamilia(familia) {
  abrirFolha({
    titulo: `${familia.icone} ${familia.nome}`,
    conteudo: el(
      "div",
      { class: "conq__degraus" },
      ...familia.medalhas.map((m) =>
        el(
          "div",
          { class: `conq__degrau ${m.conquistada ? "conq__degrau--ok" : ""}`.trim() },
          el("span", { class: "conq__degrau-marca", "aria-hidden": "true" }, m.conquistada ? "🏅" : "🔒"),
          el(
            "div",
            { class: "conq__degrau-texto" },
            el("strong", {}, m.nome),
            el("span", { class: "conq__descricao" }, m.descricao)
          ),
          m.conquistada
            ? null
            : el(
                "div",
                { class: "conq__perto-fim" },
                el("div", { class: "conq__trilha" }, el("div", { class: "conq__marca", style: { width: `${Math.round(m.progresso * 100)}%` } })),
                el("span", { class: "conq__fracao" }, m.texto ? `${m.texto} / ${m.textoAlvo}` : "")
              )
        )
      )
    ),
  });
}

/* -------------------------------------------------------------- estrutura */

function secao(titulo, ...filhos) {
  return el("section", { class: "conq__secao" }, el("h2", { class: "secao__titulo" }, titulo), ...filhos.filter(Boolean));
}
