// tela-perfil.js — nome, foto, nível e moedas.
//
// É a única folha do app com campo de texto de teclado do sistema: ninguém
// digita o próprio nome dirigindo, e um teclado numérico gigante não serve
// para escrever "Warlem".

import { el, abrirFolha } from "./ui.js";
import { cfg, salvarConfig } from "./config.js";
import { formatarXp, XP_DIA, XP_META, XP_POR_DIA_DE_OFENSIVA, MOEDA_POR_MISSAO, MOEDA_POR_DIA } from "./progresso.js";
import { ultimoProgresso, atualizarTopbar, iniciais } from "./topbar.js";
import { vibrar, mostrarToast } from "./feedback.js";

/** Lado do avatar guardado. 160px cobre a tela de retina e pesa poucos kB. */
const LADO_AVATAR = 160;

export function abrirPerfil() {
  const dados = ultimoProgresso();
  const nome = el("input", {
    class: "campo-texto",
    type: "text",
    value: cfg("nome") || "",
    placeholder: "Seu nome",
    maxLength: 40,
    autocomplete: "name",
  });

  const foto = el("div", { class: "perfil__foto" });
  const acoes = el("div", { class: "perfil__acoes" });

  const arquivo = el("input", { type: "file", accept: "image/*", hidden: true });
  arquivo.addEventListener("change", async () => {
    const escolhido = arquivo.files?.[0];
    if (!escolhido) return;
    try {
      await salvarConfig("avatar", await reduzir(escolhido));
      desenharFoto();
      atualizarTopbar();
      vibrar(30);
    } catch {
      mostrarToast({ titulo: "Não consegui ler essa imagem", tom: "alerta" });
    }
    arquivo.value = "";
  });

  abrirFolha({
    titulo: "Seu perfil",
    classe: "folha--alta",
    conteudo: [
      el("div", { class: "perfil__topo" }, foto, acoes, arquivo),
      el("label", { class: "perfil__rotulo" }, "Nome"),
      nome,
      dados ? cartaoNivel(dados) : el("p", { class: "folha__ajuda" }, "Calculando seu progresso…"),
      dados ? cartaoMoedas(dados) : null,
    ],
    rodape: (folha) => [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario",
          onClick: async () => {
            await salvarConfig("nome", nome.value.trim());
            atualizarTopbar();
            vibrar(30);
            folha.fechar();
          },
        },
        "Salvar"
      ),
    ],
  });

  // Foto e botões desenham juntos: trocar a foto tem que fazer o "Remover"
  // aparecer na hora, nao só na próxima vez que a folha abrir.
  function desenharFoto() {
    const url = cfg("avatar");
    foto.replaceChildren(
      url
        ? el("img", { class: "avatar avatar--grande avatar--foto", src: url, alt: "" })
        : el("span", { class: "avatar avatar--grande" }, iniciais(cfg("nome")))
    );
    acoes.replaceChildren(
      el("button", { type: "button", class: "botao botao--secundario", onClick: () => arquivo.click() }, url ? "Trocar foto" : "Escolher foto"),
      url
        ? el(
            "button",
            {
              type: "button",
              class: "botao botao--secundario",
              onClick: async () => {
                await salvarConfig("avatar", null);
                desenharFoto();
                atualizarTopbar();
              },
            },
            "Remover"
          )
        : null
    );
  }
  desenharFoto();
}

function cartaoNivel({ nivel, xp }) {
  const linhas = [
    [`${xp.quantasMissoes} missões cumpridas`, xp.missoes],
    [`Dias rodados (${XP_DIA} XP cada)`, xp.dias],
    [`Metas batidas (${XP_META.minima}/${XP_META.ideal}/${XP_META.otima} XP)`, xp.metas],
    [`Recorde de ofensiva (${XP_POR_DIA_DE_OFENSIVA} XP por dia)`, xp.ofensiva],
  ].filter(([, valor]) => valor > 0);

  return el(
    "section",
    { class: "perfil__cartao" },
    el(
      "div",
      { class: "perfil__nivel" },
      el("span", { class: "perfil__nivel-selo" }, String(nivel.nivel)),
      el(
        "div",
        {},
        el("strong", { class: "perfil__nivel-titulo" }, `Nível ${nivel.nivel}`),
        el("span", { class: "perfil__nivel-nota" }, `${formatarXp(nivel.faltam)} XP para o nível ${nivel.nivel + 1}`)
      )
    ),
    el("div", { class: "perfil__trilha" }, el("div", { class: "perfil__marca", style: { width: `${Math.round(nivel.progresso * 100)}%` } })),
    el("span", { class: "perfil__legenda" }, `${formatarXp(nivel.noNivel)} / ${formatarXp(nivel.custo)} XP neste nível`),
    el(
      "div",
      { class: "perfil__linhas" },
      ...linhas.map(([rotulo, valor]) =>
        el("div", { class: "perfil__linha" }, el("span", {}, rotulo), el("strong", {}, `+${formatarXp(valor)}`))
      )
    )
  );
}

function cartaoMoedas({ moedas }) {
  return el(
    "section",
    { class: "perfil__cartao perfil__cartao--moedas" },
    el(
      "div",
      { class: "perfil__moedas" },
      el("span", { class: "perfil__moeda-icone", "aria-hidden": "true" }, "🪙"),
      el("strong", { class: "perfil__moeda-valor" }, formatarXp(moedas)),
      el("span", { class: "perfil__moeda-nome" }, "moedas")
    ),
    el(
      "p",
      { class: "perfil__legenda" },
      `${MOEDA_POR_MISSAO} por missão cumprida e ${MOEDA_POR_DIA} por dia rodado. ` +
        "Ainda não há nada para comprar com elas — estão acumulando."
    )
  );
}

/**
 * A foto vai para o mesmo IndexedDB do resto. Guardar o arquivo original
 * encheria o banco com megabytes para exibir 40 pixels na barra de cima, e o
 * app precisa continuar cabendo offline.
 */
function reduzir(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error("leitura"));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => rejeitar(new Error("decodificação"));
      img.onload = () => {
        const tela = document.createElement("canvas");
        tela.width = LADO_AVATAR;
        tela.height = LADO_AVATAR;
        const pincel = tela.getContext("2d");
        // Recorte quadrado pelo centro: a barra mostra um círculo, e esticar
        // a foto para caber deformaria o rosto.
        const lado = Math.min(img.width, img.height);
        pincel.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, LADO_AVATAR, LADO_AVATAR);
        resolver(tela.toDataURL("image/jpeg", 0.82));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}
