// tela-zonas.js — desenhar as áreas de risco no mapa.
//
// NÃO EXISTE MAPA DE TELHA AQUI, e é decisão, não falta. Telha vem de servidor:
// seria rede num app que precisa funcionar em túnel, e mandaria a posição dele
// para fora num app cuja regra é que nada sai do aparelho. Então o fundo é o
// próprio rastro dele — as ruas que ele já rodou desenham a cidade que ele
// conhece, que é justamente a que importa para marcar uma área.
//
// Duas formas de marcar:
//
//   AQUI       um círculo na posição atual, com o raio no dedo. É o caminho de
//              um toque, para quando ele está parado no lugar.
//   CONTORNO   tocar o desenho ponto a ponto. Para área de formato irregular,
//              marcada em casa olhando o rastro.

import { el, abrirFolha, trocar } from "./ui.js";
import { cfg, salvarConfig } from "./config.js";
import * as store from "./store.js";
import * as Z from "./zonas.js";
import { posicaoAgora } from "./geo.js";
import { vibrar, mostrarToast } from "./feedback.js";
import * as semaforo from "./semaforo.js";

const LADO = 320;

export function abrirEditorDeZonas(repintar) {
  abrirFolha({
    titulo: "Áreas no mapa",
    classe: "folha--alta",
    conteudo: [montarEditor(repintar)],
  });
}

function montarEditor(aoFechar) {
  const raiz = el("div", { class: "zonas" });
  raiz.append(el("p", { class: "folha__ajuda" }, "Carregando o rastro…"));

  (async () => {
    const trilha = await store.trilha();
    const posicao = await posicaoAgora({ prazoMs: 5000 });
    desenharEditor(raiz, { trilha, posicao, aoFechar });
  })();

  return raiz;
}

function desenharEditor(raiz, { trilha, posicao, aoFechar }) {
  let zonas = (cfg("zonasRisco") || []).map(Z.normalizarZona);
  let rascunho = null; // polígono em construção

  const tela = el("canvas", { class: "zonas__tela", width: LADO, height: LADO });
  // O rótulo muda conforme o rascunho; sem esta referência ele congelaria em
  // "Desenhar contorno" e o contorno nunca fecharia.
  const botaoContorno = el("button", { type: "button", class: "botao" }, "Desenhar contorno");
  const legenda = el("p", { class: "zonas__legenda" }, "");
  const lista = el("div", { class: "zonas__lista" });

  const pontosDeReferencia = () => {
    const doRastro = trilha.map((p) => ({ lat: p.lat, lon: p.lon }));
    const dasZonas = zonas.flatMap((z) => (z.tipo === "poligono" ? z.pontos : z.centro ? [z.centro] : []));
    const daPosicao = posicao ? [{ lat: posicao.lat, lon: posicao.lon }] : [];
    const doRascunho = rascunho?.pontos || [];
    return [...doRastro, ...dasZonas, ...daPosicao, ...doRascunho];
  };

  const pintar = () => {
    const caixa = Z.caixaDe(pontosDeReferencia());
    const ctx = tela.getContext("2d");
    const estilo = getComputedStyle(document.documentElement);
    const cor = (nome, alternativa) => (estilo.getPropertyValue(nome) || alternativa).trim();

    ctx.clearRect(0, 0, LADO, LADO);
    ctx.fillStyle = cor("--fundo", "#0b0f14");
    ctx.fillRect(0, 0, LADO, LADO);

    if (!caixa) {
      legenda.textContent = "Sem rastro ainda. Rode com o GPS ligado, ou marque a posição atual.";
      botaoContorno.textContent = rascunho ? "Cancelar contorno" : "Desenhar contorno";
      desenharLista();
      return;
    }

    // O rastro, ao fundo e discreto: é referência, não informação.
    ctx.fillStyle = cor("--linha", "#25313d");
    for (const p of trilha) {
      const t = Z.paraTela(p, caixa, LADO, LADO);
      if (t) ctx.fillRect(t.x - 1, t.y - 1, 2, 2);
    }

    for (const z of zonas) desenharZona(ctx, z, caixa, cor);
    if (rascunho) desenharZona(ctx, { ...rascunho, rascunho: true }, caixa, cor);

    // Onde ele está agora.
    if (posicao) {
      const t = Z.paraTela(posicao, caixa, LADO, LADO);
      if (t) {
        ctx.fillStyle = cor("--serie-1", "#3987e5");
        ctx.beginPath();
        ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cor("--fundo", "#0b0f14");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    legenda.textContent = rascunho
      ? `Contorno: ${rascunho.pontos.length} ${rascunho.pontos.length === 1 ? "ponto" : "pontos"}. Precisa de 3.`
      : `${trilha.length} pontos de rastro · ${zonas.length} ${zonas.length === 1 ? "área" : "áreas"}`;
    botaoContorno.textContent = !rascunho
      ? "Desenhar contorno"
      : rascunho.pontos.length >= 3
        ? "Fechar contorno"
        : "Cancelar contorno";
    desenharLista();
  };

  const desenharLista = () => {
    trocar(lista, 
      ...zonas.map((z) =>
        el(
          "button",
          {
            type: "button",
            class: `areas__item ${z.ativa === false ? "areas__item--off" : ""}`.trim(),
            onClick: () => editarZona(z),
          },
          el("span", { class: `areas__selo areas__selo--${z.nivel}` }, z.nivel === "evitar" ? "não pegar" : "atenção"),
          el("span", { class: "areas__nome" }, z.nome),
          el("small", { class: "areas__termos" },
            z.tipo === "poligono"
              ? `contorno de ${z.pontos.length} pontos`
              : `círculo de ${z.raio} m`)
        )
      )
    );
  };

  // Toque no desenho: acrescenta ponto ao contorno em construção.
  tela.addEventListener("click", (evento) => {
    if (!rascunho) return;
    const caixa = Z.caixaDe(pontosDeReferencia());
    if (!caixa) return;
    const r = tela.getBoundingClientRect();
    const x = ((evento.clientX - r.left) / r.width) * LADO;
    const y = ((evento.clientY - r.top) / r.height) * LADO;
    const ponto = Z.daTela(x, y, caixa, LADO, LADO);
    if (!ponto) return;
    rascunho.pontos.push(ponto);
    vibrar(8);
    pintar();
  });

  const salvar = async (novas) => {
    zonas = novas.map(Z.normalizarZona);
    await salvarConfig("zonasRisco", zonas);
    await semaforo.sincronizarZonas();
    pintar();
    aoFechar?.();
  };

  const editarZona = (zona) => abrirDetalhe(zona, zonas, salvar);

  trocar(raiz, 
    tela,
    legenda,
    el(
      "div",
      { class: "zonas__acoes" },
      el(
        "button",
        {
          type: "button",
          class: "botao",
          onClick: async () => {
            if (!posicao) {
              mostrarToast({ titulo: "Sem GPS agora", detalhe: "Não dá para marcar aqui.", tom: "alerta" });
              return;
            }
            vibrar(20);
            abrirDetalhe(
              Z.normalizarZona({ nome: "", tipo: "circulo", centro: { lat: posicao.lat, lon: posicao.lon }, raio: 300 }),
              zonas,
              salvar
            );
          },
        },
        "Marcar aqui"
      ),
      botaoContorno
    ),
    lista
  );

  botaoContorno.addEventListener("click", () => {
    if (rascunho && rascunho.pontos.length >= 3) {
      const pronto = rascunho;
      rascunho = null;
      abrirDetalhe(Z.normalizarZona({ nome: "", tipo: "poligono", pontos: pronto.pontos }), zonas, salvar);
    } else {
      rascunho = rascunho ? null : { tipo: "poligono", nivel: "atencao", pontos: [] };
    }
    vibrar(8);
    pintar();
  });

  pintar();
}

function desenharZona(ctx, zona, caixa, cor) {
  const tinta = cor(zona.nivel === "evitar" ? "--nivel-abaixo" : "--nivel-piso", "#ff7b7b");
  ctx.strokeStyle = tinta;
  ctx.lineWidth = zona.rascunho ? 2 : 3;
  ctx.setLineDash(zona.rascunho ? [5, 4] : []);
  ctx.fillStyle = tinta + "33";

  if (zona.tipo === "poligono") {
    const pontos = (zona.pontos || []).map((p) => Z.paraTela(p, caixa, LADO, LADO)).filter(Boolean);
    if (!pontos.length) return;
    ctx.beginPath();
    ctx.moveTo(pontos[0].x, pontos[0].y);
    for (const p of pontos.slice(1)) ctx.lineTo(p.x, p.y);
    if (pontos.length >= 3) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
    // Os vértices, para ele ver onde tocou.
    ctx.fillStyle = tinta;
    for (const p of pontos) ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.setLineDash([]);
    return;
  }

  const centro = Z.paraTela(zona.centro, caixa, LADO, LADO);
  if (!centro) return;
  // Raio em pixel: converte usando a altura da caixa em metros.
  const alturaM = Z.metrosEntre({ lat: caixa.minLat, lon: caixa.minLon }, { lat: caixa.maxLat, lon: caixa.minLon });
  const raioPx = alturaM > 0 ? (zona.raio / alturaM) * LADO : 6;
  ctx.beginPath();
  ctx.arc(centro.x, centro.y, Math.max(4, raioPx), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ------------------------------------------------------------- detalhe */

/**
 * Edita uma área, venha ela do mapa ou da lista de Ajustes.
 *
 * Lê e grava a configuração sozinha em vez de receber a lista pronta: os dois
 * caminhos de entrada precisam salvar exatamente igual, e duas cópias da mesma
 * gravação divergem na primeira correção.
 */
export function abrirDetalheDeZona(zona, aoSalvar) {
  const zonas = (cfg("zonasRisco") || []).map(Z.normalizarZona);
  const salvar = async (novas) => {
    await salvarConfig("zonasRisco", novas.map(Z.normalizarZona));
    await semaforo.sincronizarZonas();
    aoSalvar?.();
  };
  return abrirDetalhe(zona, zonas, salvar);
}

function abrirDetalhe(zona, zonas, salvar) {
  const nome = el("input", {
    class: "campo-texto",
    type: "text",
    value: zona.nome === "Sem nome" ? "" : zona.nome,
    placeholder: "Nome do bairro",
    maxLength: 40,
  });
  const termos = el("input", {
    class: "campo-texto",
    type: "text",
    value: (zona.termos || []).join(", "),
    placeholder: "Outros nomes para o mesmo lugar",
  });

  let nivel = zona.nivel;
  let raio = zona.raio || 300;

  const valorRaio = el("strong", { class: "orc__campo-valor" }, `${raio} m`);
  const mexerRaio = (delta) => {
    raio = Math.min(Z.RAIO_MAXIMO_M, Math.max(Z.RAIO_MINIMO_M, raio + delta));
    valorRaio.textContent = `${raio} m`;
    vibrar(8);
  };

  const chipNivel = (id, rotulo) => {
    const b = el("button", { type: "button", class: `chip ${nivel === id ? "chip--ativo" : ""}`.trim() }, rotulo);
    b.addEventListener("click", () => {
      nivel = id;
      for (const outro of b.parentElement.children) outro.classList.toggle("chip--ativo", outro === b);
      vibrar(8);
    });
    return b;
  };

  abrirFolha({
    titulo: zona.nome && zona.nome !== "Sem nome" ? "Editar área" : "Nova área",
    classe: "folha--alta",
    conteudo: [
      el("label", { class: "perfil__rotulo" }, "Nome"),
      nome,

      zona.tipo === "circulo"
        ? el(
            "div",
            { class: "zonas__raio" },
            el("span", { class: "orc__campo-rotulo" }, "Raio"),
            el("button", { type: "button", class: "botao", onClick: () => mexerRaio(-100) }, "−100"),
            valorRaio,
            el("button", { type: "button", class: "botao", onClick: () => mexerRaio(100) }, "+100")
          )
        : el("p", { class: "folha__ajuda" }, `Contorno de ${zona.pontos.length} pontos.`),

      el("div", { class: "chips" }, chipNivel("atencao", "Atenção"), chipNivel("evitar", "Não pegar")),
      el("p", { class: "folha__ajuda" }, '"Não pegar" recusa mesmo com o valor bom. "Atenção" só avisa.'),

      el("label", { class: "perfil__rotulo" }, "Outros nomes"),
      termos,
      el("p", { class: "folha__ajuda" },
        "Separe por vírgula. Sirva-se aqui conforme a plataforma for mudando o " +
        "nome do lugar: cada nome novo é mais uma forma de a mesma área ser " +
        "reconhecida, e os antigos continuam valendo."),
    ],
    rodape: (folha) => [
      zonas.some((z) => z.id === zona.id)
        ? el(
            "button",
            {
              type: "button",
              class: "botao botao--perigo",
              onClick: async () => {
                await salvar(zonas.filter((z) => z.id !== zona.id));
                folha.fechar();
              },
            },
            "Apagar"
          )
        : null,
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            const nova = Z.normalizarZona({
              ...zona,
              nome: nome.value,
              nivel,
              raio,
              termos: termos.value.split(","),
            });
            if (!Z.zonaUtil(nova)) {
              mostrarToast({ titulo: "Essa área não tem posição", tom: "alerta" });
              return;
            }
            await salvar([...zonas.filter((z) => z.id !== nova.id), nova]);
            vibrar(20);
            folha.fechar();
          },
        },
        "Salvar"
      ),
    ].filter(Boolean),
  });
}
