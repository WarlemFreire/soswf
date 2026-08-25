// keypad.js — teclado numerico proprio. O teclado do sistema é pequeno demais,
// abre e fecha sozinho e rouba metade da tela; aqui cada tecla tem 80px+ e a
// posicao nunca muda, entao da pra digitar sem olhar.

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export class Teclado {
  /**
   * @param {object} opcoes
   * @param {"dinheiro"|"inteiro"} opcoes.modo
   * @param {(valor:number|null, texto:string)=>void} opcoes.aoMudar
   * @param {number[]} [opcoes.atalhos] incrementos rapidos (ex: [10, 50, 100])
   */
  constructor({ modo = "dinheiro", aoMudar = () => {}, atalhos = [] } = {}) {
    this.modo = modo;
    this.aoMudar = aoMudar;
    this.atalhos = atalhos;
    this.texto = "";
    this.el = this.#construir();
  }

  #construir() {
    const raiz = document.createElement("div");
    raiz.className = "teclado";

    if (this.atalhos.length) {
      const linha = document.createElement("div");
      linha.className = "teclado__atalhos";
      for (const passo of this.atalhos) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "chip chip--passo";
        botao.textContent = `+${passo}`;
        botao.addEventListener("click", () => this.somar(passo));
        linha.append(botao);
      }
      raiz.append(linha);
    }

    const grade = document.createElement("div");
    grade.className = "teclado__grade";

    for (const tecla of TECLAS) grade.append(this.#tecla(tecla, () => this.digitar(tecla)));

    if (this.modo === "dinheiro") {
      grade.append(this.#tecla(",", () => this.virgula(), "tecla--secundaria"));
    } else {
      grade.append(this.#tecla("00", () => this.digitar("00"), "tecla--secundaria"));
    }

    grade.append(this.#tecla("0", () => this.digitar("0")));

    const apagar = this.#tecla("⌫", () => this.apagar(), "tecla--secundaria");
    apagar.setAttribute("aria-label", "Apagar. Segure para limpar tudo.");
    let timer = null;
    const segurar = () => {
      timer = setTimeout(() => {
        this.limpar();
        if (navigator.vibrate) navigator.vibrate(15);
      }, 500);
    };
    const soltar = () => clearTimeout(timer);
    apagar.addEventListener("pointerdown", segurar);
    apagar.addEventListener("pointerup", soltar);
    apagar.addEventListener("pointerleave", soltar);
    apagar.addEventListener("pointercancel", soltar);
    grade.append(apagar);

    raiz.append(grade);
    return raiz;
  }

  #tecla(rotulo, aoTocar, classeExtra = "") {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `tecla ${classeExtra}`.trim();
    botao.textContent = rotulo;
    botao.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(8);
      aoTocar();
    });
    return botao;
  }

  digitar(digito) {
    if (this.modo === "dinheiro") {
      const [inteira, decimal] = this.texto.split(",");
      if (decimal != null) {
        if (decimal.length >= 2) return;
        this.texto = `${inteira},${decimal}${digito}`.slice(0, inteira.length + 4);
      } else {
        if (inteira && inteira.length >= 7) return;
        this.texto = (inteira || "") + digito;
      }
    } else {
      if (this.texto.length + digito.length > 8) return;
      this.texto += digito;
    }
    this.#emitir();
  }

  virgula() {
    if (this.texto.includes(",")) return;
    this.texto = (this.texto || "0") + ",";
    this.#emitir();
  }

  apagar() {
    this.texto = this.texto.slice(0, -1);
    this.#emitir();
  }

  limpar() {
    this.texto = "";
    this.#emitir();
  }

  somar(passo) {
    const atual = this.valor ?? 0;
    this.definir(atual + passo);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  definir(valor) {
    if (valor == null || Number.isNaN(valor)) {
      this.texto = "";
    } else if (this.modo === "inteiro") {
      this.texto = String(Math.round(valor));
    } else {
      const fixo = Number(valor).toFixed(2);
      this.texto = fixo.endsWith(".00") ? fixo.slice(0, -3) : fixo.replace(".", ",");
    }
    this.#emitir();
  }

  get valor() {
    if (!this.texto) return null;
    const numero = Number(this.texto.replace(",", "."));
    return Number.isFinite(numero) ? numero : null;
  }

  /** Texto pronto para exibicao, com o separador de milhar. */
  get exibicao() {
    if (!this.texto) return this.modo === "dinheiro" ? "0" : "—";
    const [inteira, decimal] = this.texto.split(",");
    const comMilhar = Number(inteira || 0).toLocaleString("pt-BR");
    return decimal != null ? `${comMilhar},${decimal}` : comMilhar;
  }

  #emitir() {
    this.aoMudar(this.valor, this.exibicao);
  }
}
