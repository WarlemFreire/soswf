// tela-perfil.js — nome e foto.
//
// Ja teve nivel, XP e moedas. Sairam: contador que ninguem gasta nao e
// recompensa, e a folha ficou sendo o que precisa ser -- onde se diz quem e.
//
// É a única folha do app com campo de texto de teclado do sistema: ninguém
// digita o próprio nome dirigindo, e um teclado numérico gigante não serve
// para escrever "Warlem".

import { el, abrirFolha } from "./ui.js";
import { cfg, salvarConfig } from "./config.js";
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
      cartaoOfensiva(dados),
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



/**
 * A foto vai para o mesmo IndexedDB do resto. Guardar o arquivo original
 * encheria o banco com megabytes para exibir 40 pixels na barra de cima, e o
 * app precisa continuar cabendo offline.
 */
/**
 * A ofensiva, e so ela. Nao e placar: é o aviso de quantos dias de folga ainda
 * cabem antes da corrente quebrar, que é a única parte disso que muda uma
 * decisão real.
 */
function cartaoOfensiva(dados) {
  const of = dados?.of;
  if (!of) return el("p", { class: "folha__ajuda" }, "Carregando…");

  const nota = !of.viva
    ? "A corrente quebrou. O próximo dia rodado começa outra."
    : of.trabalhouHoje
      ? `Hoje já conta. Recorde: ${of.recorde} dias.`
      : `${of.folgasRestantes} ${of.folgasRestantes === 1 ? "dia" : "dias"} de folga antes de quebrar. Recorde: ${of.recorde}.`;

  return el(
    "div",
    { class: "perfil__cartao" },
    el(
      "div",
      { class: "perfil__ofensiva" },
      el("span", { class: "perfil__ofensiva-icone", "aria-hidden": "true" }, of.viva ? "🔥" : "🕯️"),
      el("strong", { class: "perfil__ofensiva-valor" }, String(of.atual)),
      el("span", { class: "perfil__ofensiva-nome" }, of.atual === 1 ? "dia seguido" : "dias seguidos")
    ),
    el("p", { class: "folha__ajuda" }, nota)
  );
}

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
