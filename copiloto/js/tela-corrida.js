// tela-corrida.js — registro granular de corrida. É esta tela que alimenta a
// aba "Corridas" da planilha, e ela captura mais do que a planilha guarda:
// deslocamento até o passageiro, espera desde a corrida anterior e coordenada.
//
// Diferente do registro rápido, esta tela é usada parado — pode rolar.

import { el, limpar, abrirFolha, chips } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { cfg, PLATAFORMAS } from "./config.js";
import { vibrar, falar, mostrarToast } from "./feedback.js";

const TIPOS = [
  { id: "normal", nome: "Normal" },
  { id: "longa", nome: "Longa" },
  { id: "curta_piso", nome: "Curta de piso" },
  { id: "reserva", nome: "Reserva" },
  { id: "entrega", nome: "Entrega" },
];

const CAMPOS = [
  { id: "valorBruto", nome: "Valor", modo: "dinheiro" },
  { id: "valorDinamico", nome: "Dinâmico", modo: "dinheiro" },
  { id: "km", nome: "KM", modo: "dinheiro" },
  { id: "duracaoMin", nome: "Min", modo: "dinheiro" },
];

/** Cronômetro: um toque quando o passageiro embarca. */
export function iniciarCronometro() {
  const corrida = store.iniciarCorrida();
  if (!corrida) return;
  vibrar([25, 30, 25]);
  falar("Corrida iniciada.");
  mostrarToast({
    titulo: "Corrida em andamento",
    detalhe: "Toque em FIM quando o passageiro descer.",
    duracao: 4000,
  });
}

/**
 * Abre o formulário. Se houver cronômetro rodando, fecha-o antes e usa o que
 * foi medido para preencher km, duração, deslocamento e espera.
 */
export function abrirCorrida({ medida = null } = {}) {
  vibrar();
  const medido = medida ?? (store.corridaEmCurso() ? store.medirCorrida() : null);

  const valores = {
    valorBruto: null,
    valorDinamico: null,
    km: medido?.km ?? null,
    duracaoMin: medido?.duracaoMin ?? null,
  };
  let plataforma = cfg("plataformaPrincipal");
  let tipo = "normal";
  let origem = "";
  let destino = "";
  let campo = "valorBruto";

  const teclados = Object.fromEntries(
    CAMPOS.map((c) => [c.id, new Teclado({ modo: c.modo, aoMudar: aoDigitar })])
  );

  const visor = el("div", { class: "visor" }, "0");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "corrida__teclado" });
  const botaoOrigem = el("button", { type: "button", class: "campo-bairro", onClick: () => escolherBairro("origem") });
  const botaoDestino = el("button", { type: "button", class: "campo-bairro", onClick: () => escolherBairro("destino") });
  const medidos = el("div", { class: "corrida__medidos" });

  const linhaCampos = chips(CAMPOS, {
    selecionado: campo,
    classe: "chips--alvos",
    aoEscolher: (id) => selecionarCampo(id),
  });

  const salvar = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", disabled: true, onClick: gravar },
    "SALVAR CORRIDA"
  );

  const folha = abrirFolha({
    titulo: medido ? "Corrida — medida pelo GPS" : "Corrida detalhada",
    classe: "folha--alta",
    conteudo: [
      chips(PLATAFORMAS, {
        selecionado: plataforma,
        aoEscolher: (id) => {
          plataforma = id;
        },
      }),
      medidos,
      linhaCampos,
      visor,
      legenda,
      caixaTeclado,
      el(
        "button",
        {
          type: "button",
          class: "chip chip--pequeno",
          onClick: () => {
            teclados.valorDinamico.definir(0);
            valores.valorDinamico = 0;
            selecionarCampo("km");
            vibrar(8);
          },
        },
        "sem dinâmico"
      ),
      el("div", { class: "corrida__bairros" }, botaoOrigem, el("span", { class: "corrida__seta" }, "→"), botaoDestino),
      chips(TIPOS, {
        selecionado: tipo,
        classe: "chips--tipos",
        aoEscolher: (id) => {
          tipo = id;
        },
      }),
    ],
    rodape: [salvar],
    aoFechar: () => store.cancelarCorridaEmCurso(),
  });

  pintarMedidos();
  pintarBairros();
  selecionarCampo(campo);

  /* ------------------------------------------------------------- logica */

  function selecionarCampo(id) {
    valores[campo] = teclados[campo].valor;
    campo = id;
    caixaTeclado.replaceChildren(teclados[id].el);
    teclados[id].definir(valores[id] ?? null);
    for (const botao of linhaCampos.children) {
      botao.classList.toggle("chip--ativo", botao.dataset.id === id);
    }
    atualizar();
  }

  function aoDigitar() {
    valores[campo] = teclados[campo].valor;
    atualizar();
  }

  function atualizar() {
    visor.textContent = teclados[campo].exibicao;
    legenda.textContent = ajudaDoCampo();
    salvar.disabled = !(valores.valorBruto > 0);
  }

  function ajudaDoCampo() {
    if (campo === "valorBruto") return "Valor total recebido nesta corrida";
    if (campo === "valorDinamico") return "Quanto do valor veio de dinâmico ou bônus";
    if (campo === "km") {
      const rk = valores.valorBruto > 0 && valores.km > 0 ? valores.valorBruto / valores.km : null;
      return rk ? `R$ ${M.formatarReais(rk)}/km nesta corrida` : "Quilômetros rodados com o passageiro";
    }
    const rh =
      valores.valorBruto > 0 && valores.duracaoMin > 0
        ? (valores.valorBruto / valores.duracaoMin) * 60
        : null;
    return rh ? `R$ ${M.formatarReais(rh)}/h dentro da corrida` : "Duração em minutos";
  }

  function pintarMedidos() {
    limpar(medidos);
    if (!medido) {
      medidos.classList.add("oculto");
      return;
    }
    medidos.classList.remove("oculto");
    const itens = [];
    if (medido.km != null) itens.push(`${medido.km.toFixed(2).replace(".", ",")} km medidos`);
    if (medido.duracaoMin != null) {
      itens.push(`${String(medido.duracaoMin).replace(".", ",")} min`);
    }
    if (medido.kmDeslocamento != null) {
      itens.push(`${medido.kmDeslocamento.toFixed(2).replace(".", ",")} km até o passageiro`);
    }
    if (medido.minEspera != null) itens.push(`${medido.minEspera} min de espera antes`);
    medidos.append(el("div", { class: "corrida__medidos-texto" }, itens.join(" · ")));
  }

  function pintarBairros() {
    botaoOrigem.textContent = origem || "Origem";
    botaoDestino.textContent = destino || "Destino";
    botaoOrigem.classList.toggle("campo-bairro--vazio", !origem);
    botaoDestino.classList.toggle("campo-bairro--vazio", !destino);
  }

  function escolherBairro(qual) {
    abrirSeletorBairro((nome) => {
      if (qual === "origem") origem = nome;
      else destino = nome;
      pintarBairros();
    });
  }

  async function gravar() {
    valores[campo] = teclados[campo].valor;
    if (!(valores.valorBruto > 0)) return;

    const corrida = await store.salvarCorrida({
      timestamp: medido?.inicio ?? Date.now(),
      timestampFim: medido?.fim ?? null,
      plataforma,
      valorBruto: valores.valorBruto,
      valorDinamico: valores.valorDinamico ?? 0,
      km: valores.km,
      duracaoMin: valores.duracaoMin,
      bairroOrigem: origem,
      bairroDestino: destino,
      tipoCorrida: tipo,
      kmDeslocamento: medido?.kmDeslocamento ?? null,
      minEspera: medido?.minEspera ?? null,
      gpsInicio: medido?.gpsInicio ?? null,
      gpsFim: medido?.gpsFim ?? null,
      posicaoOrigem: medido?.posicaoOrigem ?? null,
      posicaoDestino: medido?.posicaoDestino ?? null,
    });

    folha.fechar();
    anunciar(corrida);
  }
}

function anunciar(corrida) {
  const partes = [];
  const real = M.reaisPorKmReal(corrida);
  if (corrida.km > 0) {
    partes.push(`${(corrida.valorBruto / corrida.km).toFixed(2).replace(".", ",")} R$/km`);
  }
  // Com o deslocamento na conta o numero muda bastante — é o que a planilha
  // sozinha nao mostra.
  if (real != null && corrida.kmDeslocamento > 0) {
    partes.push(`${real.toFixed(2).replace(".", ",")} com deslocamento`);
  }
  if (corrida.duracaoMin > 0) {
    partes.push(`${Math.round((corrida.valorBruto / corrida.duracaoMin) * 60)} R$/h`);
  }

  vibrar(40);
  mostrarToast({
    titulo: `+R$ ${M.formatarReais(corrida.valorBruto, { comCentavos: false })}`,
    detalhe: partes.join(" · ") || "corrida registrada",
    aoDesfazer: async () => {
      await store.removerCorrida(corrida.id);
      vibrar([15, 40, 15]);
    },
  });
  falar(`Corrida de ${Math.round(corrida.valorBruto)} reais. ${partes[0] || ""}`);
}

/* ------------------------------------------------------- seletor de bairro */

/**
 * Bairro é o único texto livre do app. A lista dos já usados vira chip, então
 * na prática, depois das primeiras semanas, é sempre um toque só.
 */
function abrirSeletorBairro(aoEscolher) {
  const conhecidos = store.bairros();
  const lista = el("div", { class: "chips chips--bairros" });
  const busca = el("input", {
    type: "text",
    class: "campo-texto",
    placeholder: "Buscar ou digitar um bairro novo",
    autocomplete: "off",
  });

  let folha;

  const normalizar = (t) =>
    t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function escolher(nome) {
    const limpo = nome.trim();
    if (!limpo) return;
    aoEscolher(limpo);
    vibrar(8);
    folha.fechar();
  }

  function pintar() {
    const filtro = normalizar(busca.value);
    const achados = conhecidos.filter((b) => normalizar(b).includes(filtro)).slice(0, 40);
    limpar(lista);
    if (busca.value.trim() && !achados.some((b) => normalizar(b) === filtro)) {
      lista.append(
        el(
          "button",
          { type: "button", class: "chip chip--novo", onClick: () => escolher(busca.value) },
          `+ usar "${busca.value.trim()}"`
        )
      );
    }
    for (const bairro of achados) {
      lista.append(el("button", { type: "button", class: "chip", onClick: () => escolher(bairro) }, bairro));
    }
    if (!achados.length && !busca.value.trim()) {
      lista.append(el("p", { class: "folha__ajuda" }, "Nenhum bairro registrado ainda — digite o primeiro."));
    }
  }

  busca.addEventListener("input", pintar);
  pintar();

  folha = abrirFolha({
    titulo: "Bairro",
    classe: "folha--alta",
    conteudo: [busca, lista],
  });
  setTimeout(() => busca.focus(), 250);
}
