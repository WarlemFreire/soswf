// parser.js — transforma o texto lido da tela "Histórico de ganhos" em dados.
//
// Nao sabe nada de imagem nem de OCR: entra texto, sai corrida. E de proposito.
// Assim da pra testar tudo no node, sem print nenhum, e o mesmo parser serve
// pros dois caminhos: texto que veio do OCR e texto que o macro leu direto da
// tela (esse vem sem erro de leitura).
//
// O desenho da tela, que é o que manda aqui:
//
//   sex., 28 de ago.                     <- titulo de secao: vale pras de baixo
//   R$ 4,39                      0:32    <- o VALOR abre a corrida, e a hora
//   Uber X · Você cancelou                  vem na mesma linha, la na direita
//   [mapa: vira lixo no OCR]
//   R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ,
//   22410-050, BR                        <- endereco quebrado em duas linhas
//   R. Aníbal de Mendonça, Ipanema - ... <- 1o endereco origem, 2o destino
//
// Ou seja: cada corrida vai da linha do valor até a proxima linha de valor.
// Tudo que nao der pra entender no meio (nome de restaurante do mapa, rua do
// mapa, numero solto) é ignorado sem estragar a corrida.

const MESES = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const TIPOS = [
  "Uber X", "UberX", "Uber Comfort", "Comfort", "Uber Black", "Black",
  "Uber XL", "UberXL", "Uber Green", "Green", "Uber Moto", "Moto",
  "Uber Flash", "Flash", "Uber Bag", "Bag", "Uber Juntos", "Juntos", "Pool",
  "Entrega", "Reserva", "Promoção", "Promocao", "Gorjeta", "Taxa", "Viagem",
];
const RE_TIPO = new RegExp(
  "\\b(" + TIPOS.map((t) => t.replace(/ /g, "\\s?")).join("|") + ")\\b",
  "i",
);

// Linha de total/semana/saldo nao é corrida, é resumo. Se entrar na conta, o
// dia dobra de valor.
const RESUMO = /\b(total|totais|ganhos?\s+d[ao]|saldo|semana|resumo|extrato|pagamento|transfer|dep[óo]sito|acumulad|m[ée]dia|saque)\b/i;

// Barra de status, cabecalho, filtros e menu de baixo. Nada disso é corrida, e
// a barra de status é perigosa: tem um relogio que viraria hora de corrida.
const CHROME = [
  /\d{1,3}\s?%/,                                   // bateria
  /\b(volte|vo\)?lte|lte|[45]g|wi-?fi)\b/i,        // rede
  /hist[óo]rico de ganhos/i,
  /^(tipo|recurso|ganhos|filtrar|filtro)$/i,
  /^(p[áa]gina inicial|descubra|caixa de entra|menu|in[íi]cio)/i,
  /\d{1,2}\/\d{1,2}\s*[–—-]\s*\d{1,2}\/\d{1,2}/,   // chip do periodo: 24/08 – 30/08
];

const SEPARADOR = /\s*[·•∙・]\s*|\s+[-.,]\s+/;

/* ------------------------------------------------------------- limpeza */

/**
 * Arruma os tropeços classicos do OCR antes de tentar entender qualquer coisa:
 * o cifrao e o digito que vira letra parecida.
 */
export function normalizar(texto) {
  return String(texto)
    .replace(/[   ]/g, " ")
    .replace(/[–—]/g, "-")
    // R$ sai como RS, R5, R§, PS, B$... sempre grudado num numero.
    .replace(/\b[RPB8]\s*[$Ss5§]\s*(?=\d|-)/g, "R$ ")
    .replace(/\bR\s+\$/g, "R$")
    // digito trocado por letra parecida: R$ 1O,5O -> R$ 10,50, 2.94 km inteiro
    .replace(/R\$\s*(-?)([\dOoIlSB][\dOoIlSB.,]*)/g, (_, sinal, n) => `R$ ${sinal}${digitos(n)}`)
    .replace(/\d[\dOoIlSB.,]*[,.]\d{2}\b/g, digitos)
    .split("\n")
    .map((linha) => limparBorda(linha.replace(/[ \t]+/g, " ").trim()))
    .filter(Boolean)
    .join("\n");
}

/**
 * Tira o lixo do comeco da linha. O icone de pin do endereço sai do OCR como
 * "?" ou ":", o do mapa como uma letra solta, e isso gruda na linha:
 *   "? R. Aníbal de Mendonça, ..."  ->  "R. Aníbal de Mendonça, ..."
 *   "2 R$ 7,04 0:20"                ->  "R$ 7,04 0:20"
 * Só cai fora token de UM caractere: "R$" e "R." tem dois e ficam.
 */
export function limparBorda(linha) {
  let saida = linha;
  for (let i = 0; i < 3; i++) {
    const cortada = saida.replace(/^[^\s-]\s+/, "");
    if (cortada === saida) break;
    saida = cortada;
  }
  return saida.replace(/^[?:;·•|<>~^"'“”]+\s*/, "").trim();
}

const digitos = (n) =>
  n.replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

export function ehChrome(linha) {
  // Linha com dinheiro nunca é enfeite de tela: pode ser corrida com "20%"
  // escrito no meio, e a barra de status jamais tem R$.
  if (/R\$\s*\d/.test(linha)) return false;
  return CHROME.some((re) => re.test(linha));
}

/* ------------------------------------------------------------- pedacos */

/** Valor em reais da linha, com sinal. null se a linha nao tem valor. */
export function valorDe(linha) {
  const m = linha.match(/(-\s*)?R\$\s*(-\s*)?(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})\b/);
  if (!m) return null;
  const valor = Number(`${m[3].replace(/[.\s]/g, "")}.${m[4]}`);
  if (!Number.isFinite(valor)) return null;
  // Taxa de cancelamento é ganho, nao desconto: so o menos escrito vira menos.
  return m[1] || m[2] ? -valor : valor;
}

export function distanciaDe(linha) {
  const m = linha.match(/(\d+(?:[,.]\d+)?)\s*km\b/i);
  if (!m) return null;
  const bruto = m[1];
  const valor = Number(bruto.replace(",", "."));
  // O OCR come o ponto de "2.94 km" e devolve "294 km". O app sempre escreve a
  // distancia com casa decimal, entao inteiro de 3+ digitos é ponto perdido.
  // Corrida de mais de 100 km existe, mas ai vem escrita "120.4" e nao cai aqui.
  if (!/[,.]/.test(bruto) && bruto.length >= 3) return valor / 100;
  return valor;
}

/** Duracao em segundos. Entende "7 min 29 segundos", "23 min", "1 h 5 min". */
export function duracaoDe(linha) {
  const horas = linha.match(/(\d+)\s*h(?:ora)?s?\b(?!\s*\d{2}\b)/i);
  const minutos = linha.match(/(\d+)\s*min\b/i);
  const segundos = linha.match(/(\d+)\s*s(?:eg(?:undo)?s?)?\b/i);
  if (!horas && !minutos && !segundos) return null;
  return (
    (horas ? Number(horas[1]) * 3600 : 0) +
    (minutos ? Number(minutos[1]) * 60 : 0) +
    (segundos ? Number(segundos[1]) : 0)
  );
}

export function horaDe(linha) {
  const m = linha.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : null;
}

export function tipoDe(linha) {
  const m = linha.match(RE_TIPO);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").replace(/^uber\s?x$/i, "Uber X");
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Data da linha, em ISO. Entende "sex., 28 de ago.", "28/08/2026", "hoje".
 * Sem ano escrito, usa o ano que faz a data cair no passado: historico nao tem
 * corrida do futuro.
 */
export function dataDe(linha, hoje = new Date()) {
  if (ehChrome(linha)) return null;
  const texto = linha.toLowerCase();
  const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  if (/\bhoje\b/.test(texto)) return iso(dia);
  if (/\bontem\b/.test(texto)) return (dia.setDate(dia.getDate() - 1), iso(dia));
  if (/\banteontem\b/.test(texto)) return (dia.setDate(dia.getDate() - 2), iso(dia));

  const extenso = texto.match(
    /\b(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s*)?(\d{4}))?/,
  );
  if (extenso) {
    return montarData(Number(extenso[1]), MESES[extenso[2]], extenso[3] ? Number(extenso[3]) : null, hoje);
  }

  const barra = texto.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (barra) {
    const ano = barra[3] ? (barra[3].length === 2 ? 2000 + Number(barra[3]) : Number(barra[3])) : null;
    return montarData(Number(barra[1]), Number(barra[2]) - 1, ano, hoje);
  }
  return null;
}

function montarData(dia, mes, ano, hoje) {
  if (mes == null || dia < 1 || dia > 31) return null;
  const data = new Date(ano ?? hoje.getFullYear(), mes, dia);
  if (data.getMonth() !== mes || data.getDate() !== dia) return null;
  if (!ano && data.getTime() > hoje.getTime() + 36e5) data.setFullYear(data.getFullYear() - 1);
  return iso(data);
}

/* ----------------------------------------------------------- enderecos */

const RE_CEP = /\b(\d{5}-?\d{3})\b/;
// "R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ, 22410-050, BR"
const RE_ENDERECO = /,\s*(BR|Brasil)\.?$|,\s*[A-Z]{2},|\b\d{5}-\d{3}\b/;

export function ehEndereco(linha) {
  return RE_ENDERECO.test(linha) && / - |,/.test(linha);
}

/**
 * Junta o endereco que o app quebrou em duas linhas. A continuacao comeca com
 * o CEP ou com "BR", e a linha de cima termina em virgula.
 */
export function juntarEnderecos(linhas) {
  const saida = [];
  for (const linha of linhas) {
    const anterior = saida[saida.length - 1];
    const continuacao = /^(\d{5}-?\d{3}|BR\b)/i.test(linha);
    if (anterior && continuacao && /,$/.test(anterior)) {
      saida[saida.length - 1] = `${anterior} ${linha}`;
    } else {
      saida.push(linha);
    }
  }
  return saida;
}

/**
 * Quebra o endereco do Uber em pedaços.
 * "R. Aníbal de Mendonça, Ipanema - Rio de Janeiro - RJ, 22410-050, BR"
 *   -> rua, bairro Ipanema, cidade Rio de Janeiro, uf RJ, cep 22410-050
 * Quando vem com sub-bairro ("Av. Vieira Souto, Arpoador, Ipanema - ...") o
 * bairro é o ultimo antes do traço, que é como o motorista chama o lugar.
 */
export function partesDoEndereco(linha) {
  const semPais = linha.replace(/,\s*(BR|Brasil)\.?$/i, "").trim();
  const cep = (semPais.match(RE_CEP) || [])[1] || null;
  const semCep = semPais.replace(RE_CEP, "").replace(/,\s*,/g, ",").replace(/,\s*$/, "").trim();

  const blocos = semCep.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const uf = blocos.length > 1 && /^[A-Z]{2}$/.test(blocos[blocos.length - 1]) ? blocos.pop() : null;
  const cidade = blocos.length > 1 ? blocos.pop() : null;
  const pedacos = (blocos[0] || "").split(",").map((p) => p.trim()).filter(Boolean);
  const bairro = pedacos.length > 1 ? pedacos[pedacos.length - 1] : null;
  const rua = pedacos.length > 1 ? pedacos.slice(0, -1).join(", ") : pedacos[0] || null;

  return { endereco: linha.trim(), rua, bairro, cidade, uf, cep };
}

/* ------------------------------------------------------------- leitura */

/**
 * Le o texto de uma tela e devolve as corridas na ordem em que aparecem.
 * `data` é a data que estava valendo no fim da tela anterior, porque print
 * rolado quase sempre comeca no meio de um dia, sem o titulo da secao.
 */
export function analisar(texto, { hoje = new Date(), data = null } = {}) {
  const linhas = juntarEnderecos(normalizar(texto).split("\n"));
  const corridas = [];
  const ignoradas = [];
  let dataAtual = data;
  let bloco = null;
  // "Ganhos da semana" numa linha e "R$ 1.842,30" na de baixo: o valor sozinho
  // nao parece resumo nenhum, entao a linha de cima precisa avisar.
  let resumoAberto = false;

  const fechar = () => {
    if (bloco) corridas.push(montarCorrida(bloco));
    bloco = null;
  };

  for (const linha of linhas) {
    if (ehChrome(linha)) continue;

    const valor = valorDe(linha);
    if (valor !== null && (RESUMO.test(linha) || resumoAberto)) {
      ignoradas.push(linha);
      resumoAberto = false;
      fechar();
      continue;
    }
    if (valor === null) resumoAberto = RESUMO.test(linha);

    if (valor !== null) {
      fechar();
      bloco = { valor, data: dataAtual, hora: horaDe(linha), linhas: [linha] };
      continue;
    }

    const dia = dataDe(linha, hoje);
    if (dia && !bloco) {
      dataAtual = dia;
      continue;
    }
    if (dia && bloco) {
      // Titulo de secao no meio da lista: fecha a corrida e vira o dia.
      fechar();
      dataAtual = dia;
      continue;
    }
    if (bloco) bloco.linhas.push(linha);
  }
  fechar();

  return { corridas, ignoradas, dataFinal: dataAtual };
}

function montarCorrida(bloco) {
  const corrida = {
    data: bloco.data,
    hora: bloco.hora,
    tipo: null,
    valor: bloco.valor,
    dinamico: null,
    status: null,
    distanciaKm: null,
    duracaoSeg: null,
    origem: null, bairroOrigem: null,
    destino: null, bairroDestino: null,
    cidade: null, uf: null,
    textoBruto: bloco.linhas.join(" | "),
  };

  const enderecos = [];
  for (const linha of bloco.linhas) {
    if (ehEndereco(linha)) {
      enderecos.push(partesDoEndereco(linha));
      continue;
    }
    corrida.hora = corrida.hora ?? horaDe(linha);
    corrida.distanciaKm = corrida.distanciaKm ?? distanciaDe(linha);
    corrida.duracaoSeg = corrida.duracaoSeg ?? duracaoDe(linha);
    if (/din[âa]mic|surge|multiplicador/i.test(linha)) {
      corrida.dinamico = valorDe(linha) ?? corrida.dinamico ?? true;
    }
    if (corrida.tipo) continue;
    const tipo = tipoDe(linha);
    if (!tipo) continue;
    corrida.tipo = tipo;
    // "Uber X · Você cancelou" / "Uber X · 7 min 29 segundos · 2.94 km"
    const partes = linha.split(SEPARADOR).map((p) => p.trim()).filter(Boolean).slice(1);
    const status = partes.find((p) => !/km|min|seg|\d+\s*h\b/i.test(p));
    if (status) corrida.status = status;
  }

  if (enderecos[0]) {
    corrida.origem = enderecos[0].endereco;
    corrida.bairroOrigem = enderecos[0].bairro;
    corrida.cidade = enderecos[0].cidade;
    corrida.uf = enderecos[0].uf;
  }
  if (enderecos[1]) {
    corrida.destino = enderecos[1].endereco;
    corrida.bairroDestino = enderecos[1].bairro;
  }
  return corrida;
}

/* -------------------------------------------------------------- juncao */

const chave = (c) =>
  [c.data ?? "?", c.hora ?? "?", c.valor.toFixed(2), (c.tipo ?? "").toLowerCase()].join("|");

const COMPLETAR = [
  "tipo", "status", "distanciaKm", "duracaoSeg", "dinamico", "data", "hora",
  "origem", "bairroOrigem", "destino", "bairroDestino", "cidade", "uf",
];

/**
 * Tira as repetidas. Print rolado sempre pega de novo as ultimas corridas do
 * print anterior; sem isso o dia vem dobrado. Quando a mesma corrida aparece
 * duas vezes, fica com o que cada leitura teve de melhor - no print em que ela
 * aparece cortada falta endereço, no outro nao.
 */
export function semRepetidas(corridas) {
  const vistas = new Map();
  const unicas = [];
  let repetidas = 0;
  for (const c of corridas) {
    const k = c.data || c.hora ? chave(c) : `bruto|${c.textoBruto}`;
    const antiga = vistas.get(k);
    if (antiga) {
      repetidas++;
      for (const campo of COMPLETAR) {
        if (antiga[campo] == null && c[campo] != null) antiga[campo] = c[campo];
      }
      if (c.textoBruto.length > antiga.textoBruto.length) antiga.textoBruto = c.textoBruto;
      continue;
    }
    vistas.set(k, c);
    unicas.push(c);
  }
  return { corridas: unicas, repetidas };
}

/* --------------------------------------------------- conserto de bairro */

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j];
      linha[j] = Math.min(
        linha[j] + 1,
        linha[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      anterior = guardado;
    }
  }
  return linha[b.length];
}

/**
 * "Ipanema" lido como "Ibanema" num print e certo em trinta outros: quem
 * aparece uma vez so e é quase igual a um bairro comum, vira o comum.
 *
 * So mexe quando a diferenca é de uma letra e o nome certo aparece pelo menos
 * tres vezes mais. Bairro de verdade que se parece com outro (Jardim Icaraí e
 * Jardim Icaraú, digamos) tem contagem parecida e fica como esta.
 */
export function padronizarBairros(corridas) {
  const contagem = new Map();
  const conta = (b) => b && contagem.set(b, (contagem.get(b) ?? 0) + 1);
  for (const c of corridas) {
    conta(c.bairroOrigem);
    conta(c.bairroDestino);
  }

  const nomes = [...contagem.keys()];
  const troca = new Map();
  for (const nome of nomes) {
    if (nome.length < 5) continue;
    const vezes = contagem.get(nome);
    let melhor = null;
    for (const outro of nomes) {
      if (outro === nome) continue;
      const vezesOutro = contagem.get(outro);
      if (vezesOutro < 2 || vezesOutro < vezes * 3) continue;
      if (distancia(nome.toLowerCase(), outro.toLowerCase()) > 1) continue;
      if (!melhor || vezesOutro > contagem.get(melhor)) melhor = outro;
    }
    if (melhor) troca.set(nome, melhor);
  }

  if (troca.size) {
    for (const c of corridas) {
      if (troca.has(c.bairroOrigem)) c.bairroOrigem = troca.get(c.bairroOrigem);
      if (troca.has(c.bairroDestino)) c.bairroDestino = troca.get(c.bairroDestino);
    }
  }
  return { corridas, corrigidos: troca.size };
}

export function totais(corridas) {
  const porDia = new Map();
  let valor = 0;
  let km = 0;
  let segundos = 0;
  let canceladas = 0;
  for (const c of corridas) {
    valor += c.valor;
    km += c.distanciaKm ?? 0;
    segundos += c.duracaoSeg ?? 0;
    if (/cancel/i.test(c.status ?? "")) canceladas++;
    const dia = c.data ?? "sem data";
    const atual = porDia.get(dia) ?? { data: dia, corridas: 0, valor: 0 };
    atual.corridas++;
    atual.valor = Math.round((atual.valor + c.valor) * 100) / 100;
    porDia.set(dia, atual);
  }
  return {
    quantidade: corridas.length,
    canceladas,
    valor: Math.round(valor * 100) / 100,
    distanciaKm: Math.round(km * 100) / 100,
    duracaoSeg: segundos,
    porDia: [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)),
  };
}

/* ---------------------------------------------------------------- saida */

export const COLUNAS = [
  ["data", "data"], ["hora", "hora"], ["tipo", "tipo"], ["valor", "valor"],
  ["dinamico", "dinâmico"], ["status", "status"], ["distanciaKm", "km"],
  ["duracaoSeg", "duração (min)"], ["bairroOrigem", "bairro origem"],
  ["bairroDestino", "bairro destino"], ["origem", "endereço origem"],
  ["destino", "endereço destino"], ["cidade", "cidade"], ["uf", "uf"],
  ["textoBruto", "texto lido"],
];

const minutos = (seg) => (seg == null ? null : Math.round((seg / 60) * 100) / 100);

/** CSV com ponto e virgula e BOM, que é o que o Excel brasileiro abre direito. */
export function paraCsv(corridas, { separadorDecimal = "," } = {}) {
  const numero = (v) => (separadorDecimal === "," ? String(v).replace(".", ",") : String(v));
  const escapar = (v) => {
    const t = v == null ? "" : String(v);
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const celula = (c, campo) => {
    if (campo === "valor") return numero(c.valor.toFixed(2));
    if (campo === "dinamico") {
      return typeof c.dinamico === "number" ? numero(c.dinamico.toFixed(2)) : c.dinamico ? "sim" : "";
    }
    if (campo === "duracaoSeg") return c.duracaoSeg == null ? "" : numero(minutos(c.duracaoSeg));
    if (campo === "distanciaKm") return c.distanciaKm == null ? "" : numero(c.distanciaKm);
    return c[campo] ?? "";
  };
  const linhas = [COLUNAS.map(([, titulo]) => titulo)];
  for (const c of corridas) linhas.push(COLUNAS.map(([campo]) => celula(c, campo)));
  return "﻿" + linhas.map((l) => l.map(escapar).join(";")).join("\n");
}

/**
 * Le varios prints de uma vez, na ordem em que foram tirados, e ja tira as
 * repetidas. A data atravessa de um print pro outro.
 */
export function extrair(textos, { hoje = new Date() } = {}) {
  const todas = [];
  const ignoradas = [];
  let data = null;
  for (const texto of textos) {
    const r = analisar(texto, { hoje, data });
    todas.push(...r.corridas);
    ignoradas.push(...r.ignoradas);
    data = r.dataFinal;
  }
  const { corridas, repetidas } = semRepetidas(todas);
  const { corrigidos } = padronizarBairros(corridas);
  return { corridas, repetidas, ignoradas, corrigidos, totais: totais(corridas) };
}
