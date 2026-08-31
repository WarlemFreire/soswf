// navegacao.js — o botão voltar do Android.
//
// Numa PWA, folha e aba são só DOM: sem entrada no histórico, o voltar do
// sistema sai do app em vez de fechar o que está aberto. Aqui cada folha e
// cada troca de aba empilham um estado, e o voltar desempilha.

const RAIZ = { copiloto: "raiz" };

let ignorarProximoPop = 0;
let fecharFolhaDoTopo = () => false;
let irParaTela = () => {};
let telaAtual = () => "agora";

/** A pilha de folhas registra quem sabe fechar a folha do topo. */
export function ligarFolhas(fn) {
  fecharFolhaDoTopo = fn;
}

export function ligarTelas({ trocar, atual }) {
  irParaTela = trocar;
  telaAtual = atual;
}

export function iniciarNavegacao() {
  if (!history.state?.copiloto) history.replaceState(RAIZ, "");

  window.addEventListener("popstate", (evento) => {
    // Uma volta que nós mesmos provocamos (fechar pelo ✕) já foi tratada.
    if (ignorarProximoPop > 0) {
      ignorarProximoPop--;
      return;
    }

    if (fecharFolhaDoTopo()) return;

    const destino = evento.state?.tela;
    if (destino) {
      irParaTela(destino, { doHistorico: true });
      return;
    }
    // Sem folha aberta e fora da tela inicial, o voltar traz para Agora. Na
    // Agora, deixamos o comportamento padrão: sair do app.
    if (telaAtual() !== "agora") irParaTela("agora", { doHistorico: true });
  });
}

export function empilharFolha() {
  history.pushState({ copiloto: "folha" }, "");
}

export function empilharTela(id) {
  history.pushState({ copiloto: "tela", tela: id }, "");
}

/**
 * Desfaz uma entrada que criamos, quando o fechamento veio da interface e não
 * do botão voltar. Sem isso as entradas acumulam e o voltar fica "morto",
 * exigindo vários toques até algo acontecer.
 */
export function desempilhar() {
  ignorarProximoPop++;
  history.back();
}
