// tela-ia.js — configurar o assistente e perguntar a ele.
//
// Duas folhas que deliberadamente não se misturam:
//
//   CONFIGURAR  mexida rara, feita em casa, com teclado do sistema. É onde a
//               chave entra e onde fica dito, por extenso, o que sai do
//               aparelho -- porque até aqui nada saía, e mudar isso sem avisar
//               seria quebrar a regra do projeto pelas costas dele.
//
//   PERGUNTAR   uso corriqueiro. Perguntas prontas na frente, porque digitar no
//               carro é caro e porque a pergunta boa vale mais que a resposta
//               boa.

import { el, abrirFolha } from "./ui.js";
import { cfg, configAtual, salvarConfig, custoTotalKm } from "./config.js";
import * as store from "./store.js";
import * as M from "./metrics.js";
import * as F from "./financeiro.js";
import * as IA from "./ia.js";
import { ofensiva } from "./ofensiva.js";
import { db } from "./db.js";
import { vibrar, mostrarToast } from "./feedback.js";

/* ----------------------------------------------------------- configurar */

export function abrirConfigDaIA(aoSalvar) {
  const chave = el("input", {
    class: "campo-texto",
    type: "password",
    value: cfg("iaChave") || "",
    placeholder: "sk-or-...",
    autocomplete: "off",
    spellcheck: "false",
  });

  const modelo = el("input", {
    class: "campo-texto",
    type: "text",
    value: cfg("iaModelo") || "",
    placeholder: "ex.: alguma/modelo",
    autocomplete: "off",
    spellcheck: "false",
  });

  const listaModelos = el("div", { class: "ia__modelos" });

  const buscar = async () => {
    listaModelos.replaceChildren(el("p", { class: "folha__ajuda" }, "Buscando no OpenRouter…"));
    try {
      const modelos = await IA.listarModelos();
      // A lista inteira passa de trezentos. Mostrar tudo numa folha de celular
      // não ajuda ninguém; o campo de texto aceita qualquer identificador.
      const baratos = modelos
        .filter((m) => m.saidaPorMil != null)
        .sort((a, b) => a.saidaPorMil - b.saidaPorMil)
        .slice(0, 40);

      listaModelos.replaceChildren(
        el("p", { class: "folha__ajuda" },
          `${modelos.length} modelos disponíveis. Os 40 mais baratos por resposta:`),
        el("div", { class: "ia__grade" },
          ...baratos.map((m) =>
            el("button", {
              type: "button",
              class: "ia__modelo",
              onClick: () => {
                modelo.value = m.id;
                vibrar(8);
              },
            },
              el("strong", {}, m.nome),
              el("small", {}, `${m.id} · saída US$ ${(m.saidaPorMil ?? 0).toFixed(4)}/mil tokens`)
            )
          )
        )
      );
    } catch (erro) {
      listaModelos.replaceChildren(
        el("p", { class: "folha__ajuda folha__ajuda--alerta" },
          `Não consegui buscar a lista: ${erro.message}. Dá para digitar o identificador à mão.`)
      );
    }
  };

  abrirFolha({
    titulo: "Assistente",
    classe: "folha--alta",
    conteudo: [
      el("p", { class: "folha__ajuda" },
        "O assistente é a ÚNICA parte do aplicativo que manda dado para fora. " +
        "Vai para o OpenRouter um resumo em números: saldo, km, horas e custo por " +
        "dia, médias, e as faixas por período."),
      el("p", { class: "folha__ajuda" },
        "NÃO vão: coordenadas, endereços, os bairros que você marcou como risco, " +
        "o texto lido da tela da plataforma, nem o seu nome."),
      el("p", { class: "folha__ajuda" },
        "O semáforo continua sem IA: ele decide offline, em fração de segundo, e " +
        "não pode depender de rede."),

      el("label", { class: "perfil__rotulo" }, "Chave do OpenRouter"),
      chave,
      el("p", { class: "folha__ajuda" },
        "Fica guardada no aparelho, sem cofre: quem destravar o celular consegue " +
        "lê-la. Vale criar uma chave com limite de gasto."),

      el("label", { class: "perfil__rotulo" }, "Modelo"),
      modelo,
      el("button", { type: "button", class: "botao", onClick: buscar }, "Buscar modelos"),
      listaModelos,
    ],
    rodape: (folha) => [
      el("button", {
        type: "button",
        class: "botao botao--primario botao--gigante",
        onClick: async () => {
          await salvarConfig("iaChave", chave.value.trim());
          await salvarConfig("iaModelo", modelo.value.trim());
          vibrar(20);
          folha.fechar();
          aoSalvar?.();
        },
      }, "Salvar"),
    ],
  });
}

/* ------------------------------------------------------------ perguntar */

export async function abrirPergunta() {
  if (!IA.configurada()) {
    mostrarToast({ titulo: "Falta configurar o assistente", detalhe: "Ajustes → Assistente", tom: "alerta" });
    return;
  }

  const campo = el("textarea", {
    class: "campo-texto ia__campo",
    rows: 3,
    placeholder: "Pergunte sobre os seus números…",
  });
  const resposta = el("div", { class: "ia__resposta" });
  let emVoo = null;

  const perguntar = async (texto) => {
    if (emVoo) emVoo.abort();
    emVoo = new AbortController();

    resposta.replaceChildren(el("p", { class: "ia__pensando" }, "Pensando…"));
    try {
      const contexto = await montarContextoAtual();
      const r = await IA.perguntar({ pergunta: texto, contexto, sinal: emVoo.signal });
      resposta.replaceChildren(
        el("div", { class: "ia__texto" }, ...r.texto.split("\n").map((l) => el("p", {}, l))),
        r.uso
          ? el("p", { class: "ia__uso" },
              `${r.modelo} · ${r.uso.total_tokens ?? "?"} tokens`)
          : null
      );
    } catch (erro) {
      resposta.replaceChildren(
        el("p", { class: "ia__erro" }, erro.message),
        el("p", { class: "folha__ajuda" },
          "Falhou com a rede ou com a chave. Nada do que o aplicativo calcula " +
          "depende disto — as abas continuam funcionando sem assistente.")
      );
    } finally {
      emVoo = null;
    }
  };

  abrirFolha({
    titulo: "Perguntar",
    classe: "folha--alta",
    conteudo: [
      el("div", { class: "ia__prontas" },
        ...IA.PERGUNTAS.map((p) =>
          el("button", {
            type: "button",
            class: "ia__pronta",
            onClick: () => {
              campo.value = p;
              vibrar(8);
              perguntar(p);
            },
          }, p)
        )
      ),
      campo,
      el("button", {
        type: "button",
        class: "botao fin__acao",
        onClick: () => perguntar(campo.value),
      }, "Perguntar"),
      resposta,
    ],
    aoFechar: () => emVoo?.abort(),
  });
}

/**
 * Junta o que vai junto da pergunta.
 *
 * Tudo sai de função que já existia e já era testada -- o assistente lê os
 * mesmos números que as abas mostram, e não uma segunda verdade só dele.
 */
async function montarContextoAtual(hoje = Date.now()) {
  const resumos = await store.historico();
  const dias = store.agruparPorDia(resumos);
  const custos = await db.todos("custos");
  const config = configAtual();
  const energiaKm = M.analiseAbastecimentos(custos).porKm;
  const impostoPct = config.impostoPct || 0;

  const semanas = F.porPeriodo(resumos, "semana", 1);
  const meses = F.porPeriodo(resumos, "mes", 1);

  return IA.montarContexto({
    dias,
    fechamentoSemana: semanas[0]
      ? F.fechamento(semanas[0].resumos, { config, energiaKmMedido: energiaKm, impostoPct })
      : null,
    fechamentoMes: meses[0]
      ? F.fechamento(meses[0].resumos, { config, energiaKmMedido: energiaKm, impostoPct })
      : null,
    faixas: store.faixasEmVigor(),
    aceite: store.referenciaDeAceite(),
    categorias: F.porCategoria(custos),
    ofensiva: ofensiva(dias, hoje),
    config: { ...config, custoTotalKm: custoTotalKm(config) },
    hoje,
  });
}
