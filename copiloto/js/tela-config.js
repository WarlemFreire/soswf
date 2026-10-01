// tela-config.js — todos os numeros do "cerebro" ficam editaveis aqui.

import { el, limpar, abrirFolha, chips } from "./ui.js";
import * as M from "./metrics.js";
import {
  cfg, configAtual, salvarConfig, restaurarPadroes,
  PERIODOS, PLATAFORMAS, CONFIG_PADRAO, custoEnergiaKm, custoTotalKm,
} from "./config.js";
import * as store from "./store.js";
import { vibrar, mostrarToast } from "./feedback.js";
import {
  exportarJson, exportarCsvJornadas, exportarCsvRegistros, exportarCsvPausas,
  exportarCsvPlanilha, exportarCsvCorridasRico, tsvPlanilha, linhaPlanilha, copiarParaAreaDeTransferencia,
  importarJson, apagarTudo,
} from "./export.js";
import { db } from "./db.js";
import { manterTelaLigada, liberarTela } from "./geo.js";
import { abrirCusto, painelCombustivel, listaDeCustos } from "./tela-custo.js";
import * as semaforo from "./semaforo.js";
import * as Z from "./zonas.js";
import * as risco from "./risco.js";
import { entregarArquivo } from "./plataforma.js";
import * as IA from "./ia.js";
import * as Mod from "./modelo.js";
import * as treino from "./treino.js";
import { abrirConfigDaIA, abrirPergunta } from "./tela-ia.js";
import { abrirEditorDeZonas, abrirDetalheDeZona } from "./tela-zonas.js";

export function montarConfig(raiz) {
  limpar(raiz);

  raiz.append(
    secao("Metas do dia (bruto)", [
      numero("Mínima", "metaMinima", { passo: 10, sufixo: "R$" }),
      numero("Ideal", "metaIdeal", { passo: 10, sufixo: "R$" }),
      numero("Ótima", "metaOtima", { passo: 10, sufixo: "R$" }),
      numero("Hora limite para a meta", "horaLimiteMeta", { passo: 1, min: 0, max: 23, sufixo: "h" }),
      numero("Janela do bloco", "blocoMin", { passo: 15, min: 30, max: 300, sufixo: "min" }),
      el(
        "p",
        { class: "folha__ajuda" },
        "O bloco mostra como está indo o pedaço recente da jornada, sem o peso das horas fracas " +
          "do começo do dia. Abaixo de 2h a janela costuma ficar magra demais para significar algo."
      ),
    ]),

    secao("Faixa de R$/hora", [
      numero("Piso", "faixaHora.piso", { passo: 1, sufixo: "R$/h" }),
      numero("Ideal", "faixaHora.ideal", { passo: 1, sufixo: "R$/h" }),
      numero("Ótimo", "faixaHora.otimo", { passo: 1, sufixo: "R$/h" }),
    ]),

    secaoFaixasKm(),

    secao("Custo do carro", [
      numero("Preço do GNV", "precoGnv", { passo: 0.1, casas: 2, sufixo: "R$/m³" }),
      numero("Consumo de GNV", "kmPorM3", { passo: 0.5, casas: 1, sufixo: "km/m³" }),
      numero("Preço do etanol", "precoEtanol", { passo: 0.1, casas: 2, sufixo: "R$/l" }),
      numero("Consumo de etanol", "kmPorLitro", { passo: 0.5, casas: 1, sufixo: "km/l" }),
      numero("% rodado no GNV", "mixGnvPct", { passo: 5, min: 0, max: 100, sufixo: "%" }),
      numero("Desgaste do carro", "custoDesgasteKm", { passo: 0.05, casas: 2, sufixo: "R$/km" }),
      resumoCusto(),
    ]),

    secao("Abastecimento", [
      el(
        "p",
        { class: "folha__ajuda" },
        "Os valores acima são semente. A partir do segundo abastecimento com odômetro, " +
          "o custo por km passa a ser medido de bomba a bomba — e o histórico inteiro é recalculado."
      ),
      painelCombustivel(),
      listaDeCustos(),
      el(
        "button",
        { type: "button", class: "botao botao--primario", onClick: () => abrirCusto() },
        "Registrar abastecimento ou gasto",
      ),
    ]),

    secao("Plataformas", [
      escolha("Principal (já vem selecionada)", "plataformaPrincipal", PLATAFORMAS.map((p) => ({ valor: p.id, nome: p.nome }))),
      ...PLATAFORMAS.map((p) =>
        interruptor(`Mostrar ${p.nome}`, null, {
          ler: () => cfg("plataformasAtivas").includes(p.id),
          gravar: async (ligado) => {
            const atuais = new Set(cfg("plataformasAtivas"));
            ligado ? atuais.add(p.id) : atuais.delete(p.id);
            await salvarConfig("plataformasAtivas", PLATAFORMAS.map((x) => x.id).filter((id) => atuais.has(id)));
          },
        })
      ),
    ]),

    secaoAssistente(),

    secaoSemaforo(),

    secao("No carro", [
      interruptor("Marcar a zona no registro (GPS)", "marcarPosicao"),
      interruptor("Medir o km por GPS", "rastrearKm", {
        aoMudar: (ligado) => (ligado ? store.ligarRastreio() : store.desligarRastreio()),
      }),
      interruptor("Manter a tela ligada", "manterTelaLigada", {
        aoMudar: (ligado) => (ligado ? manterTelaLigada() : liberarTela()),
      }),
      interruptor("Vibrar ao registrar", "vibrar"),
      interruptor("Ler resultados em voz alta", "tts"),
      interruptor("Modo dirigindo", "modoDirigindo"),
      escolha("Tema", "tema", [
        { valor: "auto", nome: "Automático" },
        { valor: "escuro", nome: "Sempre escuro" },
        { valor: "claro", nome: "Sempre claro" },
      ]),
      numero("Escurecer a partir de", "horaModoNoturno", { passo: 1, min: 0, max: 23, sufixo: "h" }),
      numero("Avisar pausa longa após", "alertaPausaMin", { passo: 5, sufixo: "min" }),
    ]),

    secaoDados()
  );
}

/* ------------------------------------------------------------ componentes */

/**
 * O semáforo de ofertas. Seção própria porque depende de duas permissões que só
 * o usuário concede, na tela do Android — e porque cada uma, faltando, deixa o
 * recurso mudo de um jeito diferente. Dizer qual está faltando é a diferença
 * entre "não funciona" e "falta um toque aqui".
 */
/**
 * O assistente.
 *
 * Seção própria e separada do semáforo porque são opostos: o semáforo é
 * determinístico, offline e decide em fração de segundo; o assistente depende
 * de rede, custa dinheiro por pergunta e responde em texto. Juntá-los na mesma
 * seção sugeriria que um depende do outro -- e a independência é o ponto.
 */
function secaoAssistente() {
  const caixa = el("div", { class: "config__secao" });

  const pintar = () => {
    const pronto = IA.configurada();
    caixa.replaceChildren(
      el("h2", { class: "secao__titulo" }, "Assistente"),
      el("p", { class: "campo__ajuda" },
        pronto
          ? `Pronto, usando ${cfg("iaModelo")}. Pergunte pela aba Análise.`
          : "Responde perguntas sobre os seus números, em texto. É a única parte " +
            "do aplicativo que manda dado para fora, e por isso vem desligada."),
      blocoAprendizado(),
      el("div", { class: "zonas__acoes" },
        el("button", {
          type: "button",
          class: "botao",
          onClick: () => abrirConfigDaIA(pintar),
        }, pronto ? "Mexer na configuração" : "Configurar"),
        pronto
          ? el("button", { type: "button", class: "botao", onClick: () => abrirPergunta() }, "Perguntar")
          : null,
      ),
      pronto
        ? el("p", { class: "campo__ajuda" },
            "O semáforo não usa isto: ele continua decidindo offline e sozinho.")
        : null,
    );
  };

  pintar();
  return caixa;
}

/**
 * O que o aplicativo aprendeu sozinho.
 *
 * Fica visível e com número porque a alternativa seria pedir fé. Enquanto o
 * modelo erra mais que um palpite simples, a tela DIZ isso em vez de mostrar
 * uma recomendação bonita -- é a mesma regra do travessão: melhor admitir que
 * não sabe do que inventar confiança.
 */
function blocoAprendizado() {
  const caixa = el("div", { class: "aprend" });

  (async () => {
    const modelo = await store.carregarModelo();
    const d = Mod.desempenho(modelo);
    const rec = treino.recomendacao(modelo);

    if (!d.pronto) {
      caixa.replaceChildren(
        el("p", { class: "campo__ajuda" },
          `Aprendendo com as suas jornadas: ${modelo.n} ${modelo.n === 1 ? "observação" : "observações"}. ` +
          "Ele começa a opinar depois de rodar o bastante para errar menos que um palpite simples. " +
          "Isso acontece no aparelho, sem custo por pergunta.")
      );
      return;
    }

    caixa.replaceChildren(
      el("div", { class: "aprend__linha" },
        el("span", {}, "Erro do modelo"),
        el("strong", {}, `${d.erro} R$/h`)),
      el("div", { class: "aprend__linha" },
        el("span", {}, "Erro de um palpite simples"),
        el("strong", {}, `${d.erroBase} R$/h`)),
      el("p", {
        class: `campo__ajuda ${d.melhorQueAMedia ? "aprend__bom" : "aprend__ruim"}`,
      },
        d.melhorQueAMedia
          ? `Está acertando ${d.ganhoPct}% melhor que a média simples, com ${modelo.n} observações.`
          : "Ainda erra mais que a média simples, então não está recomendando nada. " +
            "Mais jornadas resolvem isso sozinhas."),
      rec
        ? el("p", { class: "campo__ajuda" },
            `Agora ele apostaria na ${rec.regiao}: ~${rec.reaisPorHora} R$/h` +
            (rec.explorando ? " — e marcaria como teste, porque conhece pouco de lá." : "."))
        : null
    );
  })();

  return caixa;
}

function secaoSemaforo() {
  const caixa = el("div", { class: "config__secao" });

  const pintar = async () => {
    const e = await semaforo.estado();
    const cortes = semaforo.cortesAgora();

    const filhos = [el("h2", { class: "secao__titulo" }, "Semáforo de ofertas")];

    if (!e.suportado) {
      // A lista de áreas continua aqui de propósito: ela é dado dele, e vale
      // cadastrar no navegador para já chegar pronta quando abrir o aplicativo.
      filhos.push(
        el("p", { class: "campo__ajuda" },
          e.nativo
            ? "Esta é a versão LIMPA: ela não lê a tela de outros aplicativos nem " +
              "desenha por cima deles, e por isso não é barrada por aplicativo de " +
              "banco. O semáforo está na versão Copiloto+."
            : "O semáforo só funciona no aplicativo instalado: o navegador não " +
              "pode ler a tela de outro aplicativo."
        ),
        el("p", { class: "campo__ajuda" }, "As áreas abaixo já podem ser marcadas."),
        listaDeAreas(() => pintar())
      );
      caixa.replaceChildren(...filhos);
      return;
    }

    filhos.push(
      el("p", { class: "campo__ajuda" },
        "Lê o valor, o km e o tempo da oferta na tela da plataforma e mostra na hora " +
        "se ela paga acima do seu piso. O texto lido não é gravado nem enviado para " +
        "nenhum lugar."
      ),
      interruptor("Ligado", "semaforoLigado", {
        // Lê do APARELHO, não da configuração. Os dois podiam divergir -- a
        // configuração volta do backup, o estado do serviço não -- e quando
        // divergiam esta tela dizia "ligado" sobre um serviço que descartava
        // tudo. Interruptor que mente é pior que interruptor que falta.
        ler: () => e.ligado,
        gravar: async (v) => {
          await salvarConfig("semaforoLigado", v);
          await semaforo.ligar(v);
        },
        aoMudar: () => pintar(),
      })
    );

    // Com o leitor de pé, o botão de desligar vem ANTES de tudo: ele é
    // procurado com pressa, na fila do banco, não com calma em casa.
    if (e.acessibilidadeAtiva) {
      filhos.push(
        el("button", {
          type: "button",
          class: "botao botao--perigo fin__acao",
          onClick: async () => {
            const r = await semaforo.desligarLeitor();
            vibrar(30);
            mostrarToast(
              r.desligou
                ? { titulo: "Leitor desligado", detalhe: "O aplicativo de banco já deve abrir." }
                : { titulo: "Não consegui desligar", detalhe: "Desligue na tela de acessibilidade.", tom: "alerta" }
            );
            // O Android leva um instante para tirar o serviço da lista. Repintar
            // na hora mostraria o estado velho, que é pior que não mostrar nada.
            setTimeout(pintar, 600);
          },
        }, "Desligar o leitor (para usar o banco)"),
        el("p", { class: "campo__ajuda" },
          "Tira o leitor da lista de acessibilidade do Android. O aplicativo de " +
          "banco recusa o aparelho enquanto ele estiver lá, e com razão: ler a " +
          "tela de outro aplicativo é metade do golpe de sobreposição. " +
          "Para religar depois, é pela tela do Android — nenhum aplicativo pode " +
          "se reconceder isso sozinho."),
      );
    }

    // Cada pendência é uma linha com o botão que resolve ela.
    if (!e.acessibilidadeAtiva) {
      filhos.push(
        pendencia(
          "Falta autorizar a leitura de tela",
          "Abrir acessibilidade",
          () => semaforo.abrirAcessibilidade()
        )
      );
    }
    if (!e.podeSobrepor) {
      filhos.push(
        pendencia(
          "Falta autorizar desenhar sobre outros aplicativos",
          "Abrir permissão",
          () => semaforo.abrirSobreposicao()
        )
      );
    }
    if (!cortes) {
      filhos.push(
        el("p", { class: "campo__ajuda" },
          `Ainda sem base nesta faixa horária${e.amostra ? ` (${e.amostra} de 12 ofertas)` : ""}. ` +
          "Até lá o selo aparece CINZA, com os números da oferta e sem veredito — " +
          "ele não chuta cor, mas também não fica mudo."
        )
      );
    } else {
      filhos.push(
        el("p", { class: "campo__ajuda" },
          `Agora (${cortes.periodo}): recusar abaixo de ${cortes.pisoHora.toFixed(0)} R$/h. ` +
          `Boa a partir de ${cortes.idealHora.toFixed(0)}, ótima de ${cortes.otimoHora.toFixed(0)}. ` +
          `Prejuízo abaixo de ${cortes.custoKm.toFixed(2).replace(".", ",")} R$/km.`
        )
      );
    }

    filhos.push(await blocoEstado(e), listaDeAreas(() => pintar()), blocoDiagnostico(e, () => pintar()));

    caixa.replaceChildren(...filhos);
  };

  pintar();
  // Voltar da tela do Android tem que atualizar o que está pendente.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pintar();
  });
  return caixa;
}

/**
 * O estado do semáforo em quatro linhas, em português.
 *
 * Existe porque "não está aparecendo nada" não tem como ser investigado de
 * dentro do carro. Cada linha separa um ponto da corrente, e a de baixo é a que
 * mais diz: se ofertas foram lidas e mesmo assim não apareceu selo, o problema
 * é desenhar por cima; se nenhuma foi lida, é leitura.
 */
async function blocoEstado(e) {
  let lidas = 0;
  try {
    lidas = (await semaforo.ofertasDoDia()).length;
  } catch {
    /* sem banco a conta não sai; as outras linhas ainda valem */
  }

  const linha = (rotulo, ok, detalhe) =>
    el("div", { class: "campo" },
      el("span", { class: `campo__rotulo${ok ? "" : " campo__rotulo--alerta"}` },
        `${ok ? "✓" : "✗"} ${rotulo}`),
      el("span", { class: "campo__ajuda" }, detalhe));

  return el("div", { class: "config__estado" },
    linha("Leitor de tela autorizado", e.acessibilidadeAtiva,
      e.acessibilidadeAtiva ? "o Android está entregando a tela" : "reinstalar apaga esta permissão"),
    linha("Pode desenhar por cima", e.podeSobrepor,
      e.podeSobrepor ? "o selo tem onde aparecer" : "sem isto o selo não tem como ser desenhado"),
    linha("Semáforo ligado", e.ligado,
      e.ligado ? "o serviço está olhando as ofertas" : "o interruptor acima"),
    linha("Ofertas lidas hoje", lidas > 0, lidas > 0
      ? `${lidas} — a leitura está funcionando`
      : "nenhuma ainda; com tudo autorizado e uma oferta na tela, isto tem que subir")
  );
}

/**
 * Os bairros que ele não quer pegar.
 *
 * O caminho principal é DIGITAR O NOME, porque é o nome que aparece na oferta e
 * é o que ele consegue alimentar aos poucos, conforme a plataforma muda. O mapa
 * continua ali, mas de lado: exige estar no lugar ou reconhecer o rastro, e
 * isso trava o cadastro em vez de destravá-lo.
 *
 * Nome de RUA não entra por escolha dele, e a escolha é certa: rua com número
 * viraria uma lista infinita que nunca fica pronta. Bairro é a unidade que a
 * oferta mostra e que ele reconhece de cabeça.
 */
function listaDeAreas(repintar) {
  const zonas = (cfg("zonasRisco") || []).map(Z.normalizarZona);

  const entrada = el("input", {
    class: "campo-texto",
    type: "text",
    placeholder: "Nome do bairro",
    maxLength: 40,
    autocomplete: "off",
  });

  const adicionar = async () => {
    const nome = entrada.value.trim();
    if (!nome) return;
    if (!risco.termoValido(nome)) {
      mostrarToast({ titulo: "Nome curto demais", detalhe: "Três letras ou mais.", tom: "alerta" });
      return;
    }
    // Entra como "não pegar": é uma lista do que ele NÃO quer. Um toque no item
    // rebaixa para "atenção" quando o bairro é ruim só em parte.
    const nova = Z.normalizarZona({ nome, nivel: "evitar", termos: [nome] });
    await salvarConfig("zonasRisco", [...zonas, nova]);
    await semaforo.sincronizarZonas();
    entrada.value = "";
    vibrar(20);
    repintar();
  };

  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Enter") adicionar();
  });

  return el(
    "div",
    { class: "areas" },
    el("h3", { class: "areas__titulo" }, "Bairros que eu não pego"),

    zonas.length
      ? el("div", { class: "areas__lista" },
          ...zonas.map((z) =>
            el("button", {
              type: "button",
              class: `areas__item ${z.ativa === false ? "areas__item--off" : ""}`.trim(),
              onClick: () => abrirDetalheDeZona(z, repintar),
            },
              el("span", { class: `areas__selo areas__selo--${z.nivel}` },
                z.nivel === "evitar" ? "não pegar" : "atenção"),
              el("span", { class: "areas__nome" }, z.nome),
              el("small", { class: "areas__termos" }, descreverZona(z)),
            )
          ),
        )
      : null,

    el("div", { class: "areas__novo" },
      entrada,
      el("button", { type: "button", class: "botao", onClick: adicionar }, "Adicionar"),
    ),

    el("p", { class: "campo__ajuda" },
      zonas.length
        ? "Toque num bairro para acrescentar outros nomes, rebaixar para atenção ou apagar."
        : "Digite o nome como ele aparece na oferta. Depois dá para acrescentar " +
          "outros nomes para o mesmo bairro, conforme a plataforma mudar."),

    el("button", {
      type: "button",
      class: "botao areas__mapa",
      onClick: () => abrirEditorDeZonas(repintar),
    }, "Desenhar no mapa"),
  );
}

/**
 * Captura do que o serviço lê. É o que substitui o chute.
 *
 * Fica no fim da seção, discreto: não é para uso diário. Mas quando o semáforo
 * erra, é a única forma de saber POR QUE sem estar no carro junto.
 */
function blocoDiagnostico(estado, repintar) {
  if (!estado?.suportado) return null;

  const caixa = el("div", { class: "areas" });

  const pintar = async () => {
    const d = await semaforo.lerDiagnostico();
    caixa.replaceChildren(
      el("h3", { class: "areas__titulo" }, "Ver o que ele está lendo"),
      el("p", { class: "campo__ajuda" },
        d.ligado
          ? `Gravando. ${d.capturas.length} ${d.capturas.length === 1 ? "captura" : "capturas"} guardadas. ` +
            "Desliga sozinho em duas horas."
          : "Guarda no aparelho o texto que o serviço lê da tela da plataforma, " +
            "para descobrir por que ele erra. Nada sai daqui sozinho."),
      el("div", { class: "zonas__acoes" },
        el("button", {
          type: "button",
          class: "botao",
          onClick: async () => {
            await semaforo.ligarDiagnostico(!d.ligado);
            vibrar(20);
            pintar();
          },
        }, d.ligado ? "Parar de gravar" : "Gravar"),
        d.capturas.length
          ? el("button", {
              type: "button",
              class: "botao",
              onClick: async () => {
                const texto = semaforo.diagnosticoEmTexto(d.capturas);
                try {
                  await entregarArquivo(`copiloto-leitura-${Date.now()}.txt`, texto, "text/plain");
                } catch {
                  mostrarToast({ titulo: "Não consegui compartilhar", tom: "alerta" });
                }
              },
            }, "Compartilhar")
          : null,
        d.capturas.length
          ? el("button", {
              type: "button",
              class: "botao botao--perigo",
              onClick: async () => {
                await semaforo.limparDiagnostico();
                vibrar(8);
                pintar();
              },
            }, "Apagar")
          : null,
      ),
      d.capturas.length
        ? el("pre", { class: "diag__amostra" },
            semaforo.diagnosticoEmTexto(d.capturas.slice(0, 1)))
        : null,
    );
  };

  pintar();
  return caixa;
}

function descreverZona(z) {
  const partes = [];
  // O termo igual ao nome não é informação: ele já está escrito acima. Só os
  // apelidos ADICIONAIS valem a linha.
  const proprio = risco.normalizar(z.nome);
  const apelidos = (z.termos || []).filter((t) => risco.normalizar(t) !== proprio);
  if (apelidos.length) partes.push(`também: ${apelidos.join(" · ")}`);
  if (Z.temGeometria(z)) partes.push(z.tipo === "poligono" ? `contorno de ${z.pontos.length} pontos` : `círculo de ${z.raio} m`);
  return partes.join(" · ") || "só este nome";
}

/**
 * Uma pendência: o que falta, e o botão que resolve.
 *
 * EMPILHADO, não lado a lado. Em linha, o rótulo espremia em três linhas no
 * celular enquanto o botão tomava metade da largura -- e justo estas são as
 * linhas que ele precisa achar com pressa. Botão de largura inteira também dá
 * alvo de toque maior, que é a regra do projeto.
 */
function pendencia(texto, rotuloBotao, acao) {
  return el(
    "div",
    { class: "campo campo--coluna" },
    el("span", { class: "campo__rotulo campo__rotulo--alerta" }, texto),
    el("button", { type: "button", class: "botao fin__acao", onClick: acao }, rotuloBotao)
  );
}

function secao(titulo, filhos) {
  return el("section", { class: "config__secao" }, el("h2", { class: "secao__titulo" }, titulo), ...filhos.filter(Boolean));
}

function lerCaminho(caminho) {
  const [raiz, folha] = caminho.split(".");
  return folha ? cfg(raiz)[folha] : cfg(raiz);
}

async function gravarCaminho(caminho, valor) {
  const [raiz, folha] = caminho.split(".");
  if (!folha) return salvarConfig(raiz, valor);
  return salvarConfig(raiz, { ...cfg(raiz), [folha]: valor });
}

/** Campo numerico com stepper — sem teclado do sistema, alvos grandes. */
function numero(rotulo, caminho, { passo = 1, casas = 0, min = 0, max = Infinity, sufixo = "" } = {}) {
  const valorEl = el("span", { class: "campo__valor" }, "");

  const pintar = () => {
    const v = lerCaminho(caminho);
    valorEl.textContent = `${Number(v).toFixed(casas).replace(".", ",")}${sufixo ? " " + sufixo : ""}`;
  };

  const ajustar = async (direcao) => {
    const atual = Number(lerCaminho(caminho));
    const bruto = atual + direcao * passo;
    const novo = Math.min(max, Math.max(min, Number(bruto.toFixed(4))));
    await gravarCaminho(caminho, novo);
    pintar();
    vibrar(8);
    store.notificar();
  };

  pintar();
  return el(
    "div",
    { class: "campo" },
    el("span", { class: "campo__rotulo" }, rotulo),
    el(
      "div",
      { class: "campo__stepper" },
      el("button", { type: "button", class: "stepper", onClick: () => ajustar(-1), "aria-label": `Diminuir ${rotulo}` }, "−"),
      valorEl,
      el("button", { type: "button", class: "stepper", onClick: () => ajustar(1), "aria-label": `Aumentar ${rotulo}` }, "+")
    )
  );
}

function interruptor(rotulo, chave, { ler, gravar, aoMudar } = {}) {
  const lerValor = ler || (() => !!cfg(chave));
  const gravarValor = gravar || ((v) => salvarConfig(chave, v));

  const botao = el("button", { type: "button", class: "interruptor", role: "switch" });
  const pintar = () => {
    const ligado = lerValor();
    botao.setAttribute("aria-checked", String(ligado));
    botao.classList.toggle("interruptor--ligado", ligado);
    botao.textContent = ligado ? "SIM" : "NÃO";
  };
  botao.addEventListener("click", async () => {
    const novo = !lerValor();
    await gravarValor(novo);
    pintar();
    vibrar(8);
    aoMudar?.(novo);
    store.notificar();
  });
  pintar();

  return el("div", { class: "campo" }, el("span", { class: "campo__rotulo" }, rotulo), botao);
}

function escolha(rotulo, chave, opcoes) {
  const linha = el("div", { class: "campo__opcoes" });
  for (const opcao of opcoes) {
    const botao = el(
      "button",
      {
        type: "button",
        class: `chip ${cfg(chave) === opcao.valor ? "chip--ativo" : ""}`.trim(),
        onClick: async () => {
          await salvarConfig(chave, opcao.valor);
          for (const irmao of linha.children) irmao.classList.remove("chip--ativo");
          botao.classList.add("chip--ativo");
          vibrar(8);
          store.notificar();
          document.dispatchEvent(new CustomEvent("copiloto:tema"));
        },
      },
      opcao.nome
    );
    linha.append(botao);
  }
  return el("div", { class: "campo campo--coluna" }, el("span", { class: "campo__rotulo" }, rotulo), linha);
}

function secaoFaixasKm() {
  const corpo = el("div", { class: "faixas" });
  const pintar = () => {
    limpar(corpo);
    for (const periodo of PERIODOS) {
      const faixa = cfg("faixasKm")[periodo.id];
      corpo.append(
        el(
          "button",
          {
            type: "button",
            class: "faixa",
            onClick: () => editarFaixa(periodo, pintar),
          },
          el("span", { class: "faixa__nome" }, `${periodo.nome} ${periodo.inicio}h–${periodo.fim}h`),
          el(
            "span",
            { class: "faixa__valores" },
            `${faixa.piso.toFixed(2).replace(".", ",")} · ${faixa.ideal.toFixed(2).replace(".", ",")} · ${faixa.otimo.toFixed(2).replace(".", ",")}`
          )
        )
      );
    }
  };
  pintar();

  return el(
    "section",
    { class: "config__secao" },
    el("h2", { class: "secao__titulo" }, "Faixas de R$/km por período"),
    el(
      "p",
      { class: "folha__ajuda" },
      "Estes valores são do rendimento da JORNADA (contando km vazio), não da corrida ofertada. " +
        "Toque num período para ajustar piso · ideal · ótimo."
    ),
    corpo
  );
}

function editarFaixa(periodo, aoSalvar) {
  const faixa = { ...cfg("faixasKm")[periodo.id] };
  const campos = ["piso", "ideal", "otimo"].map((chave) => {
    const valorEl = el("span", { class: "campo__valor" }, "");
    const pintar = () => (valorEl.textContent = faixa[chave].toFixed(2).replace(".", ","));
    const ajustar = (dir) => {
      faixa[chave] = Math.max(0, Number((faixa[chave] + dir * 0.05).toFixed(2)));
      pintar();
      vibrar(8);
    };
    pintar();
    return el(
      "div",
      { class: "campo" },
      el("span", { class: "campo__rotulo" }, chave === "otimo" ? "Ótimo" : chave[0].toUpperCase() + chave.slice(1)),
      el(
        "div",
        { class: "campo__stepper" },
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(-1) }, "−"),
        valorEl,
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(1) }, "+")
      )
    );
  });

  let folha;
  folha = abrirFolha({
    titulo: `${periodo.nome} · ${periodo.inicio}h–${periodo.fim}h`,
    conteudo: [
      ...campos,
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            await salvarConfig("faixasKm", { ...cfg("faixasKm"), [periodo.id]: faixa });
            aoSalvar();
            store.notificar();
            folha.fechar();
          },
        },
        "SALVAR"
      ),
    ],
  });
}

function resumoCusto() {
  const caixa = el("div", { class: "custo-resumo" });
  const pintar = () => {
    const c = configAtual();
    const medido = store.energiaKm();
    const energia = medido > 0 ? medido : custoEnergiaKm(c);
    const total = energia + (c.custoDesgasteKm || 0);
    limpar(caixa);
    caixa.append(
      el("div", {}, `Energia: R$ ${M.formatarReais(energia)}/km ${medido > 0 ? "(medido)" : "(semente)"}`),
      el("div", { class: "custo-resumo__total" }, `Break-even: R$ ${M.formatarReais(total)}/km`),
      el("div", { class: "custo-resumo__nota" }, `Num dia de 200 km: R$ ${M.formatarReais(total * 200, { comCentavos: false })} de custo`)
    );
  };
  pintar();
  store.assinar(pintar);
  return caixa;
}

/**
 * Prévia da primeira linha que sera colada. Colar numero como texto zera as
 * formulas da planilha sem avisar; ver a linha antes evita a surpresa.
 */
function previaPlanilha() {
  const caixa = el("pre", { class: "previa" });
  const pintar = async () => {
    const corridas = (await db.todos("corridas")).sort((a, b) => b.timestamp - a.timestamp);
    caixa.textContent = corridas.length
      ? linhaPlanilha(corridas[0]).join("  |  ")
      : "Sem corridas registradas — nada para pré-visualizar.";
  };
  pintar();
  store.assinar(pintar);
  document.addEventListener("copiloto:tema", pintar);
  return el("div", {}, el("p", { class: "folha__ajuda" }, "Prévia da linha mais recente:"), caixa);
}

/* -------------------------------------------------------------- dados */

function secaoDados() {
  const arquivo = el("input", { type: "file", accept: ".json,application/json", class: "oculto" });
  arquivo.addEventListener("change", async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    try {
      const contagem = await importarJson(await f.text(), { modo: "mesclar" });
      const total = Object.values(contagem).reduce((s, n) => s + n, 0);
      await store.carregarJornadaAberta();
      mostrarToast({ titulo: "Backup restaurado", detalhe: `${total} linhas importadas` });
    } catch (erro) {
      mostrarToast({ titulo: "Não deu para importar", detalhe: erro.message, tom: "alerta" });
    }
    arquivo.value = "";
  });

  const acao = (rotulo, fn, classe = "botao--secundario") =>
    el(
      "button",
      {
        type: "button",
        class: `botao ${classe}`,
        onClick: async () => {
          vibrar();
          await fn();
        },
      },
      rotulo
    );

  return el(
    "section",
    { class: "config__secao" },
    el("h2", { class: "secao__titulo" }, "Para a planilha"),
    el(
      "p",
      { class: "folha__ajuda" },
      "As colunas saem na ordem exata da aba Corridas (Data até Destino). " +
        "As colunas de fórmula da planilha não são tocadas."
    ),
    escolha("Separador decimal da planilha", "separadorDecimal", [
      { valor: ",", nome: "Vírgula  1.234,56" },
      { valor: ".", nome: "Ponto  1234.56" },
    ]),
    previaPlanilha(),
    el(
      "div",
      { class: "config__botoes" },
      acao("Copiar todas as corridas", async () => {
        const corridas = (await db.todos("corridas")).sort((a, b) => a.timestamp - b.timestamp);
        if (!corridas.length) {
          mostrarToast({ titulo: "Nenhuma corrida registrada ainda", tom: "alerta" });
          return;
        }
        const deu = await copiarParaAreaDeTransferencia(tsvPlanilha(corridas));
        mostrarToast({
          titulo: deu ? `${corridas.length} corridas copiadas` : "Não deu para copiar",
          detalhe: deu ? "Cole na primeira linha vazia da aba Corridas." : "Use o CSV abaixo.",
          tom: deu ? "ok" : "alerta",
          duracao: 6000,
        });
      }, "botao--primario"),
      acao("CSV no formato da planilha", async () => {
        const corridas = (await db.todos("corridas")).sort((a, b) => a.timestamp - b.timestamp);
        await exportarCsvPlanilha(corridas);
      }),
      acao("CSV completo das corridas", exportarCsvCorridasRico)
    ),

    el("h2", { class: "secao__titulo secao__titulo--espacado" }, "Backup e dados"),
    el(
      "p",
      { class: "folha__ajuda" },
      "Tudo fica só neste aparelho. Exporte de tempos em tempos — se o celular sumir, os dados vão junto."
    ),
    el(
      "div",
      { class: "config__botoes" },
      acao("Backup completo (JSON)", exportarJson, "botao--primario"),
      acao("CSV dos dias", exportarCsvJornadas),
      acao("CSV dos registros", exportarCsvRegistros),
      acao("CSV das pausas", exportarCsvPausas),
      acao("Restaurar backup", () => arquivo.click())
    ),
    arquivo,
    el(
      "div",
      { class: "config__botoes config__botoes--perigo" },
      acao("Restaurar padrões de fábrica", async () => {
        await restaurarPadroes();
        montarConfig(document.getElementById("tela-config"));
        mostrarToast({ titulo: "Configurações voltaram ao padrão" });
      }, "botao--texto"),
      acao("Apagar todos os dados", confirmarApagar, "botao--texto botao--perigo")
    ),
    el("p", { class: "versao" }, `Copiloto · Fase 1 · padrões calibrados em ${M.formatarReais(CONFIG_PADRAO.precoGnv)}/m³`)
  );
}

function confirmarApagar() {
  let folha;
  folha = abrirFolha({
    titulo: "Apagar tudo?",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "Isto apaga jornadas, registros e pausas deste aparelho. Não tem desfazer. Exporte um backup antes."),
      el(
        "div",
        { class: "acoes acoes--coluna" },
        el("button", { type: "button", class: "botao botao--secundario botao--gigante", onClick: () => folha.fechar() }, "Cancelar"),
        el(
          "button",
          {
            type: "button",
            class: "botao botao--perigo botao--gigante",
            onClick: async () => {
              await apagarTudo();
              await store.carregarJornadaAberta();
              folha.fechar();
              mostrarToast({ titulo: "Tudo apagado", tom: "alerta" });
            },
          },
          "Apagar mesmo assim"
        )
      ),
    ],
  });
}
