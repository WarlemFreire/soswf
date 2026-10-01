// tela-orcamento.js — quanto cobrar numa corrida particular.
//
// A tela existe para mostrar o que a conta de cabeça esconde. O motorista olha
// "20 km, 40 minutos" e pensa no preço da viagem; a folha mostra o km e o tempo
// TOTAIS que aquilo ocupa, incluindo a ida até o cliente e a volta vazia, e o
// que sobra de verdade por hora depois do custo.
//
// O preço aparece em cima e se refaz a cada toque, porque a pergunta é sempre
// "e se eu cobrar por isso?" -- não vale esconder o resultado atrás de um botão
// calcular.

import { el, abrirFolha, trocar } from "./ui.js";
import { configAtual, cfg, salvarConfig } from "./config.js";
import * as store from "./store.js";
import * as M from "./metrics.js";
import * as O from "./orcamento.js";
import { Teclado } from "./keypad.js";
import { db, novoId } from "./db.js";
import { vibrar, mostrarToast } from "./feedback.js";

export function abrirOrcamento(aoSalvar) {
  const estado = {
    km: 0,
    minutos: 0,
    kmAteCliente: 0,
    minutosEspera: 0,
    voltaVazio: true,
    alvoHora: O.alvoSugerido(store.referenciaDeAceite()) ?? cfg("alvoHoraOrcamento") ?? 40,
  };

  const preco = el("div", { class: "orc__preco" }, "—");
  const explicacao = el("div", { class: "orc__explica" });
  const detalhe = el("div", { class: "orc__detalhe" });

  const campos = el("div", { class: "orc__campos" });

  const pintar = () => {
    const r = O.orcar({ ...estado, config: configAtual() });

    if (!r) {
      preco.textContent = "—";
      explicacao.textContent = "Informe o km e o tempo da viagem.";
      trocar(detalhe);
      return r;
    }

    preco.textContent = `R$ ${M.formatarReais(r.preco, { comCentavos: false })}`;
    explicacao.textContent =
      r.manda === "tempo"
        ? "Mandou o tempo: é demorada para a distância."
        : "Mandou o custo: é longa para o tempo.";

    trocar(detalhe, 
      linha("Rodando de verdade", `${r.kmTotal.toFixed(0)} km`, `viagem ${r.kmViagem.toFixed(0)} · ida ${r.kmIda.toFixed(0)} · volta ${r.kmVolta.toFixed(0)}`),
      linha("Ocupado de verdade", M.formatarDuracao(r.minutosTotal * 60000), `${Math.round(r.minutosMorto)} min só de deslocamento`),
      linha("Custo de rodar", `R$ ${M.formatarReais(r.custo)}`, `${r.custoKm.toFixed(2).replace(".", ",")}/km`),
      linha("Sobra", `R$ ${M.formatarReais(r.lucro)}`, ""),
      linha("Rende de fato", r.reaisPorHora == null ? "—" : `${r.reaisPorHora.toFixed(0)} R$/h`,
        "já descontado o custo e o tempo morto", true),
    );
    return r;
  };

  const campo = (rotulo, chave, { modo = "inteiro", sufixo = "", ajuda = "" }) => {
    const valor = el("strong", { class: "orc__campo-valor" }, "0");
    const botao = el(
      "button",
      {
        type: "button",
        class: "orc__campo",
        onClick: async () => {
          const n = await pedirNumero({ titulo: rotulo, valorInicial: estado[chave] || null, modo, ajuda });
          if (n == null) return;
          estado[chave] = n;
          valor.textContent = `${n}${sufixo}`;
          vibrar(8);
          pintar();
        },
      },
      el("span", { class: "orc__campo-rotulo" }, rotulo),
      valor
    );
    valor.textContent = `${estado[chave] || 0}${sufixo}`;
    return botao;
  };

  trocar(campos, 
    campo("Km da viagem", "km", { sufixo: " km" }),
    campo("Minutos da viagem", "minutos", { sufixo: " min" }),
    campo("Km até o cliente", "kmAteCliente", { sufixo: " km", ajuda: "Deslocamento para buscar." }),
    campo("Espera combinada", "minutosEspera", { sufixo: " min" }),
    campo("Quero ganhar por hora", "alvoHora", {
      sufixo: " R$/h",
      ajuda: "O alvo desta corrida. Vem do seu histórico quando existe.",
    }),
    interruptorVolta(estado, pintar)
  );

  pintar();

  abrirFolha({
    titulo: "Orçar particular",
    classe: "folha--alta",
    conteudo: [
      el("div", { class: "orc__topo" }, preco, el("p", { class: "orc__explica-linha" }, explicacao)),
      campos,
      detalhe,
    ],
    rodape: (folha) => [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            const r = O.orcar({ ...estado, config: configAtual() });
            if (!r) {
              mostrarToast({ titulo: "Falta o km e o tempo", tom: "alerta" });
              return;
            }
            await salvarConfig("alvoHoraOrcamento", estado.alvoHora);
            await db.put("orcamentos", {
              id: novoId(),
              timestamp: Date.now(),
              ...estado,
              preco: r.preco,
              custo: r.custo,
              lucro: r.lucro,
              reaisPorHora: r.reaisPorHora,
              kmTotal: r.kmTotal,
              minutosTotal: r.minutosTotal,
            });
            vibrar(20);
            mostrarToast({ titulo: `Orçamento salvo: R$ ${M.formatarReais(r.preco, { comCentavos: false })}` });
            folha.fechar();
            aoSalvar?.();
          },
        },
        "Salvar orçamento"
      ),
    ],
  });
}

function linha(rotulo, valor, nota, destaque = false) {
  return el(
    "div",
    { class: `orc__linha ${destaque ? "orc__linha--destaque" : ""}`.trim() },
    el("span", { class: "orc__linha-rotulo" }, rotulo, nota ? el("small", {}, nota) : null),
    el("strong", {}, valor)
  );
}

function interruptorVolta(estado, pintar) {
  const botao = el("button", { type: "button", class: "orc__campo" });
  const valor = el("strong", { class: "orc__campo-valor" }, "");
  const pintarBotao = () => {
    valor.textContent = estado.voltaVazio ? "SIM" : "NÃO";
  };
  botao.append(el("span", { class: "orc__campo-rotulo" }, "Volta vazio"), valor);
  botao.addEventListener("click", () => {
    estado.voltaVazio = !estado.voltaVazio;
    pintarBotao();
    vibrar(8);
    pintar();
  });
  pintarBotao();
  return botao;
}

/** O teclado próprio do app, nunca o do sistema — ele pode estar no carro. */
function pedirNumero({ titulo, valorInicial = null, modo = "inteiro", ajuda = "" }) {
  return new Promise((resolve) => {
    let valor = valorInicial;
    let confirmou = false;

    const mostrador = el("div", { class: "folha__mostrador" }, "0");
    const teclado = new Teclado({
      modo,
      aoMudar: (n, texto) => {
        valor = n;
        mostrador.textContent = texto || "0";
      },
    });
    if (valorInicial != null) teclado.definir(valorInicial);
    mostrador.textContent = teclado.texto || "0";

    abrirFolha({
      titulo,
      conteudo: [mostrador, ajuda ? el("p", { class: "folha__ajuda" }, ajuda) : null, teclado.el].filter(Boolean),
      rodape: (folha) => [
        el(
          "button",
          {
            type: "button",
            class: "botao botao--primario botao--gigante",
            onClick: () => {
              confirmou = true;
              folha.fechar();
            },
          },
          "Usar"
        ),
      ],
      aoFechar: () => resolve(confirmou ? valor : null),
    });
  });
}

/** Os orçamentos salvos, do mais recente para o mais antigo. */
export async function orcamentosSalvos(quantos = 5) {
  const todos = await db.todos("orcamentos");
  return todos.sort((a, b) => b.timestamp - a.timestamp).slice(0, quantos);
}

export async function apagarOrcamento(id) {
  await db.remover("orcamentos", id);
}
