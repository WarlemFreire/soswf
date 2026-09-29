// financeiro.js — bruto → líquido, reserva e conciliação. Puro e testável.
//
// A PERGUNTA QUE ESTE ARQUIVO RESPONDE é "quanto sobrou de verdade", que não é
// o número que a plataforma mostra. E responder isso exige três decisões que
// não são óbvias:
//
// 1. COMBUSTÍVEL: lançado quando existe, estimado quando não. O gasto real dos
//    abastecimentos da janela é melhor que km × preço, porque o preço da
//    configuração envelhece e o consumo varia. Mas semana sem abastecimento
//    lançado não gastou zero de combustível -- ela gastou e não foi anotado.
//    Então cai para a estimativa E DIZ QUE CAIU.
//
// 2. DESGASTE NÃO É CUSTO DEDUZIDO, É RESERVA. Este é o ponto mais fácil de
//    errar, e errar aqui mente para os dois lados. Se o desgaste por km fosse
//    descontado do líquido E a manutenção real também fosse lançada como custo,
//    a mesma despesa sairia duas vezes. O desgaste é provisão: dinheiro que
//    devia estar guardado para quando a manutenção chegar. Quando ela chega,
//    é lançamento e reduz o líquido -- e a reserva é o que devia estar lá para
//    pagá-la.
//
//    Por isso: LÍQUIDO = bruto − combustível − custos lançados.
//              RESERVA = desgaste/km × km + imposto% × bruto.
//              SOBRA   = líquido − reserva.
//
// 3. DIA SEM KM NÃO TEM CUSTO ESTIMÁVEL. Ele entra no bruto e fica de fora da
//    estimativa, e o fechamento declara que está incompleto. Melhor um líquido
//    admitidamente parcial do que um líquido que parece completo e não é.

import * as M from "./metrics.js";

/** As categorias de custo do app, na ordem em que aparecem. */
export const CATEGORIAS = [
  { id: "gnv", nome: "GNV", combustivel: true },
  { id: "gasolina", nome: "Gasolina", combustivel: true },
  { id: "etanol", nome: "Etanol", combustivel: true },
  { id: "pedagio", nome: "Pedágio" },
  { id: "alimentacao", nome: "Alimentação" },
  { id: "lavagem", nome: "Lavagem" },
  { id: "manutencao", nome: "Manutenção" },
  { id: "outro", nome: "Outro" },
];

const DIA_MS = 86400000;

/* ----------------------------------------------------------------- janelas */

/**
 * Chave do período a que uma data pertence.
 *
 * A semana começa na SEGUNDA, não no domingo: domingo é dia de trabalho forte
 * para motorista, e cortar a semana no meio do fim de semana partiria o fim de
 * semana em duas semanas diferentes.
 */
export function chaveDoPeriodo(dataIso, tipo) {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  if (tipo === "mes") return `${ano}-${String(mes).padStart(2, "0")}`;
  if (tipo === "dia") return dataIso;

  const d = new Date(ano, mes - 1, dia);
  const diaDaSemana = (d.getDay() + 6) % 7; // 0 = segunda
  const segunda = new Date(d.getTime() - diaDaSemana * DIA_MS);
  return M.chaveData(segunda.getTime());
}

/** Rótulo legível de um período. */
export function rotuloDoPeriodo(chave, tipo) {
  if (tipo === "mes") {
    const [ano, mes] = chave.split("-").map(Number);
    const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${nomes[mes - 1]}/${String(ano).slice(2)}`;
  }
  const [ano, mes, dia] = chave.split("-").map(Number);
  if (tipo === "dia") return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
  const fim = new Date(new Date(ano, mes - 1, dia).getTime() + 6 * DIA_MS);
  const dd = (n) => String(n).padStart(2, "0");
  return `${dd(dia)}/${dd(mes)}–${dd(fim.getDate())}/${dd(fim.getMonth() + 1)}`;
}

/**
 * Agrupa os resumos de jornada em períodos, do mais recente para o mais antigo.
 * `quantos` corta a lista; 0 devolve todos.
 */
export function porPeriodo(resumos, tipo, quantos = 0) {
  const baldes = new Map();
  for (const r of resumos || []) {
    const chave = chaveDoPeriodo(r.jornada.data, tipo);
    if (!baldes.has(chave)) baldes.set(chave, { chave, tipo, rotulo: rotuloDoPeriodo(chave, tipo), resumos: [] });
    baldes.get(chave).resumos.push(r);
  }
  const lista = [...baldes.values()].sort((a, b) => (a.chave < b.chave ? 1 : -1));
  return quantos > 0 ? lista.slice(0, quantos) : lista;
}

/* -------------------------------------------------------------- fechamento */

/**
 * A conta descendo, para um conjunto de jornadas.
 *
 * `energiaKmMedido` vem dos abastecimentos reais (analiseAbastecimentos) e
 * substitui o preço semeado na configuração quando existe.
 */
export function fechamento(resumos, { config, energiaKmMedido = null, impostoPct = 0 } = {}) {
  const lista = resumos || [];
  const custos = lista.flatMap((r) => r.custos || []);

  const bruto = soma(lista, (r) => r.saldo);
  const km = soma(lista, (r) => r.km);
  const msAtivo = lista.reduce((t, r) => t + (r.msAtivo || 0), 0);
  const diasSemKm = lista.filter((r) => !(r.km > 0)).length;

  const combustivelLancado = custos
    .filter((c) => M.ehCombustivel(c.tipo))
    .reduce((t, c) => t + (c.valor || 0), 0);

  const estimativa = config ? M.custosEstimados(km, config, energiaKmMedido) : null;

  // Abastecimento lançado ganha. Sem nenhum, a janela não gastou zero de
  // combustível: ela gastou e não foi anotado, então vale a estimativa.
  const combustivel = combustivelLancado > 0
    ? { valor: combustivelLancado, fonte: "lancado" }
    : { valor: estimativa?.energia ?? 0, fonte: estimativa ? "estimado" : "sem-dado" };

  const outros = {
    valor: custos.filter((c) => !M.ehCombustivel(c.tipo)).reduce((t, c) => t + (c.valor || 0), 0),
    fonte: "lancado",
  };

  const liquido = bruto - combustivel.valor - outros.valor;

  // Reserva: provisão, não despesa já feita. Ver o cabeçalho.
  const desgaste = (config?.custoDesgasteKm || 0) * km;
  const imposto = bruto * (Math.max(0, impostoPct) / 100);
  const reserva = { desgaste, imposto, total: desgaste + imposto };

  return {
    dias: lista.length,
    bruto,
    km,
    msAtivo,
    combustivel,
    outros,
    liquido,
    reserva,
    sobra: liquido - reserva.total,
    // Líquidos, não brutos: é o que sobra por hora e por km de verdade.
    reaisPorHora: msAtivo > 0 ? (liquido / msAtivo) * M.HORA : null,
    reaisPorKm: km > 0 ? liquido / km : null,
    // Sem km em algum dia a estimativa não cobre a janela inteira.
    completo: diasSemKm === 0,
    diasSemKm,
  };
}

/* --------------------------------------------------------- para onde vai */

/**
 * Custo por categoria, do maior para o menor.
 *
 * `maximo` dobra a cauda em "Outros" em vez de gerar mais cores: a paleta do
 * app só tem quatro tons categóricos que se separam sob daltonismo, e inventar
 * um quinto quebraria isso.
 */
export function porCategoria(custos, { maximo = 4 } = {}) {
  const totais = new Map();
  for (const c of custos || []) {
    const id = c.tipo || "outro";
    totais.set(id, (totais.get(id) || 0) + (c.valor || 0));
  }

  const total = [...totais.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return { total: 0, fatias: [] };

  const ordenadas = [...totais.entries()]
    .map(([id, valor]) => ({ id, nome: nomeDaCategoria(id), valor }))
    .sort((a, b) => b.valor - a.valor);

  const fatias = ordenadas.slice(0, maximo - 1);
  const cauda = ordenadas.slice(maximo - 1);
  if (cauda.length === 1) fatias.push(cauda[0]);
  else if (cauda.length > 1) {
    fatias.push({ id: "resto", nome: "Outros", valor: cauda.reduce((t, c) => t + c.valor, 0) });
  }

  return { total, fatias: fatias.map((f) => ({ ...f, fatia: f.valor / total })) };
}

export function nomeDaCategoria(id) {
  return CATEGORIAS.find((c) => c.id === id)?.nome || "Outro";
}

/* ------------------------------------------------------------ conciliação */

/**
 * Compara o que o app registrou com o que a plataforma pagou de fato.
 *
 * Não existe "diferença aceitável" fixa aqui: o app mostra o número e a
 * porcentagem, e quem julga é ele. Um corte arbitrário de "ok até 2%" só
 * ensinaria a ignorar diferença pequena e sistemática, que é justamente a que
 * mais custa ao longo dos meses.
 */
export function conciliacao({ registrado, informado }) {
  const r = Number(registrado);
  const i = Number(informado);
  if (!Number.isFinite(r) || !Number.isFinite(i)) return null;

  const diferenca = i - r;
  return {
    registrado: r,
    informado: i,
    diferenca,
    // Sem base não existe percentual — travessão, nunca divisão por zero.
    pct: r > 0 ? (diferenca / r) * 100 : null,
    aFavor: diferenca >= 0,
  };
}

function soma(lista, pegar) {
  return (lista || []).reduce((t, x) => t + (pegar(x) || 0), 0);
}
