// ia.js — assistente opcional, via OpenRouter.
//
// ONDE A IA NÃO ENTRA, E ISSO É REGRA: no semáforo. A decisão de aceitar
// corrida acontece em fração de segundo, offline, às vezes dentro de túnel, e
// precisa dar a mesma resposta para a mesma oferta. Chamada de rede não cabe
// ali, e modelo de linguagem não é determinístico. O semáforo continua sendo
// aritmética local sobre percentis do histórico dele.
//
// ONDE A IA ENTRA: onde o tempo não é crítico e a pergunta é aberta. "O que
// mudou na minha semana?", "vale a pena a madrugada de terça?", "para onde foi
// meu dinheiro?". Coisas que exigem ler números juntos e explicar, não decidir
// em meio segundo.
//
// O QUE SAI DO APARELHO. Até aqui, nada saía: era a regra do projeto. Com o
// assistente ligado, o que vai para o OpenRouter são AGREGADOS -- saldo, km,
// horas e custo por dia, médias, faixas por período. Não vão coordenadas, nem
// endereços, nem os bairros que ele marcou como risco, nem o texto capturado da
// tela da plataforma, nem o nome dele. Isso é decisão de projeto, não economia
// de bytes: um resumo numérico responde as perguntas úteis sem contar onde ele
// mora, por onde anda ou de onde foge.
//
// A chave fica na configuração, no aparelho. Não é cofre: quem tiver o aparelho
// desbloqueado consegue lê-la, como consegue ler o resto. Vale uma chave com
// limite de gasto no OpenRouter.

import { configAtual } from "./config.js";

const BASE = "https://openrouter.ai/api/v1";

/** Teto de resposta. Ele lê no celular; resposta longa não é lida. */
export const MAX_TOKENS = 900;

/** Dias de histórico que vão no contexto. Mais que isso encarece sem ajudar. */
export const DIAS_DE_CONTEXTO = 30;

/** Prazo da chamada. Passando disso, é melhor falhar do que travar a tela. */
const PRAZO_MS = 45000;

export function temChave(config = configAtual()) {
  return Boolean((config.iaChave || "").trim());
}

export function configurada(config = configAtual()) {
  return temChave(config) && Boolean((config.iaModelo || "").trim());
}

/* ------------------------------------------------------------- o prompt */

/**
 * O que o modelo precisa saber para não estragar o que o app já acertou.
 *
 * Cada regra aqui corresponde a um erro que este projeto já cometeu na rua.
 * Elas não são enfeite de prompt: são a memória do que custou noite de trabalho.
 */
export function promptDoSistema() {
  return [
    "Você é o copiloto de um motorista de aplicativo brasileiro. Ele lê suas",
    "respostas no celular, muitas vezes parado no carro, às vezes cansado.",
    "",
    "COMO RESPONDER",
    "- Português do Brasil, direto. Sem saudação, sem repetir a pergunta.",
    "- Curto: no máximo uns quatro parágrafos curtos, ou uma lista enxuta.",
    "- Número sempre com a unidade e o período (R$/h da tarde, R$/km da jornada).",
    "",
    "A REGRA MAIS IMPORTANTE: NUNCA INVENTE NÚMERO.",
    "- Use apenas os números que estão nos dados abaixo. Não estime, não",
    "  complete, não arredonde para um valor 'bonito'.",
    "- Se a resposta exige um dado que não está aí, diga exatamente qual dado",
    "  falta. Dizer 'não dá para saber com o que eu tenho' é resposta correta e",
    "  desejada; chutar não é.",
    "- Amostra pequena é amostra pequena: se um período tem poucos dias, diga",
    "  isso antes de concluir qualquer coisa dele.",
    "",
    "DUAS ESCALAS DE R$/km, E ELAS NÃO SE COMPARAM.",
    "- CORRIDA OFERTADA: valor dividido pelo km da corrida. Fica perto de 3,40.",
    "- JORNADA: ganho do turno dividido pelo km do turno, contando km vazio.",
    "  Fica perto de 1,90, quase metade.",
    "Misturar as duas faz corrida ruim parecer boa e vice-versa. Sempre diga de",
    "qual das duas você está falando.",
    "",
    "LÍQUIDO E RESERVA",
    "- Líquido = bruto − combustível − custos lançados.",
    "- O desgaste do carro NÃO sai do líquido: é reserva, provisão para a",
    "  manutenção futura. Se ele lança a manutenção quando ela chega e você",
    "  também descontar o desgaste, a mesma despesa sai duas vezes.",
    "",
    "O QUE VOCÊ NÃO FAZ",
    "- Não decide se uma corrida específica vale a pena. Isso é do semáforo, que",
    "  é determinístico e roda offline. Se ele perguntar, explique o critério",
    "  dele mesmo em vez de dar um veredito novo.",
    "- Não sugere dirigir mais quando os dados mostram cansaço. Turno longo,",
    "  madrugada emendada e dia sem folga não viram recomendação, viram alerta.",
    "- Não dá conselho jurídico, tributário ou médico. Aponte que é caso de",
    "  procurar um profissional.",
  ].join("\n");
}

/**
 * Monta o pacote de dados que acompanha a pergunta.
 *
 * PURO de propósito: é aqui que se decide o que sai do aparelho, e isso tem que
 * ser verificável por teste, não por leitura de código.
 */
export function montarContexto({
  dias = [],
  fechamentoSemana = null,
  fechamentoMes = null,
  faixas = null,
  aceite = null,
  categorias = null,
  ofensiva = null,
  config = {},
  hoje = Date.now(),
} = {}) {
  const corte = hoje - DIAS_DE_CONTEXTO * 86400000;

  return {
    hoje: new Date(hoje).toISOString().slice(0, 10),

    // Parâmetros dele, não dados pessoais.
    parametros: {
      metaMinima: config.metaMinima ?? null,
      metaIdeal: config.metaIdeal ?? null,
      metaOtima: config.metaOtima ?? null,
      custoPorKm: arredondar(config.custoTotalKm, 3),
      impostoPct: config.impostoPct ?? 0,
    },

    // Um dia = uma linha de números. Sem bairro, sem coordenada, sem corrida.
    dias: (dias || [])
      .filter((d) => d.inicio == null || d.inicio >= corte)
      .slice(-DIAS_DE_CONTEXTO)
      .map((d) => ({
        data: d.data,
        bruto: arredondar(d.saldo, 2),
        km: arredondar(d.km, 1),
        horas: d.msAtivo ? arredondar(d.msAtivo / 3600000, 2) : null,
        liquido: d.temLiquido ? arredondar(d.liquido, 2) : null,
        corridas: Array.isArray(d.corridas) ? d.corridas.length : null,
      })),

    semana: resumirFechamento(fechamentoSemana),
    mes: resumirFechamento(fechamentoMes),

    // Faixas da JORNADA (com km vazio).
    faixasDaJornada: faixas || null,
    // Faixas da CORRIDA OFERTADA (sem km vazio). Nomes diferentes de propósito.
    faixasDaOferta: aceite || null,

    custosPorCategoria: categorias?.fatias
      ? categorias.fatias.map((f) => ({ categoria: f.nome, valor: arredondar(f.valor, 2) }))
      : null,

    ofensiva: ofensiva ? { atual: ofensiva.atual, recorde: ofensiva.recorde } : null,
  };
}

function resumirFechamento(f) {
  if (!f) return null;
  return {
    dias: f.dias,
    bruto: arredondar(f.bruto, 2),
    km: arredondar(f.km, 1),
    horas: arredondar(f.msAtivo / 3600000, 2),
    combustivel: arredondar(f.combustivel?.valor, 2),
    combustivelMedido: f.combustivel?.fonte === "lancado",
    outrosCustos: arredondar(f.outros?.valor, 2),
    liquido: arredondar(f.liquido, 2),
    reservaDesgaste: arredondar(f.reserva?.desgaste, 2),
    reservaImposto: arredondar(f.reserva?.imposto, 2),
    sobra: arredondar(f.sobra, 2),
    reaisPorHoraLiquido: arredondar(f.reaisPorHora, 2),
    reaisPorKmLiquido: arredondar(f.reaisPorKm, 2),
    completo: f.completo,
  };
}

function arredondar(valor, casas) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** As mensagens da chamada. Separado do envio para poder ser testado. */
export function montarMensagens(pergunta, contexto) {
  return [
    { role: "system", content: promptDoSistema() },
    {
      role: "user",
      content: [
        "DADOS (use só estes números):",
        "```json",
        JSON.stringify(contexto, null, 1),
        "```",
        "",
        "PERGUNTA:",
        String(pergunta || "").trim(),
      ].join("\n"),
    },
  ];
}

/* -------------------------------------------------------------- chamada */

/**
 * A lista de modelos do OpenRouter, ao vivo.
 *
 * Existe para ele ESCOLHER em vez de eu adivinhar um identificador: nome de
 * modelo muda, some e é renomeado, e um padrão errado chumbado no código falha
 * calado. Não exige chave.
 */
export async function listarModelos({ sinal } = {}) {
  const resposta = await fetch(`${BASE}/models`, { signal: sinal });
  if (!resposta.ok) throw new Error(`OpenRouter respondeu ${resposta.status}`);
  const dados = await resposta.json();
  return (dados?.data || [])
    .map((m) => ({
      id: m.id,
      nome: m.name || m.id,
      contexto: m.context_length ?? null,
      // Preço por token; multiplicado por mil para caber na cabeça.
      entradaPorMil: precoPorMil(m?.pricing?.prompt),
      saidaPorMil: precoPorMil(m?.pricing?.completion),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function precoPorMil(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n * 1000 : null;
}

/**
 * Pergunta ao modelo.
 *
 * Devolve `{ texto, uso }`. Lança com mensagem legível quando falha -- e falhar
 * tem que ser visível: assistente que erra calado é pior que assistente nenhum.
 */
export async function perguntar({ pergunta, contexto, config = configAtual(), sinal } = {}) {
  const chave = (config.iaChave || "").trim();
  const modelo = (config.iaModelo || "").trim();
  if (!chave) throw new Error("Falta a chave do OpenRouter.");
  if (!modelo) throw new Error("Falta escolher o modelo.");
  if (!String(pergunta || "").trim()) throw new Error("Pergunta vazia.");

  const abortar = new AbortController();
  const prazo = setTimeout(() => abortar.abort(), PRAZO_MS);
  sinal?.addEventListener?.("abort", () => abortar.abort());

  try {
    const resposta = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        // Identificam o app nos painéis do OpenRouter. Não carregam dado dele.
        "HTTP-Referer": "https://soswf.com/copiloto",
        "X-Title": "Copiloto",
      },
      body: JSON.stringify({
        model: modelo,
        messages: montarMensagens(pergunta, contexto),
        max_tokens: MAX_TOKENS,
        // Baixa de propósito: a pergunta é sobre números, não sobre criatividade.
        temperature: 0.2,
      }),
      signal: abortar.signal,
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      throw new Error(mensagemDeErro(resposta.status, corpo));
    }

    const dados = await resposta.json();
    const texto = dados?.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error("O modelo respondeu vazio.");

    return { texto, uso: dados?.usage || null, modelo: dados?.model || modelo };
  } catch (erro) {
    if (erro?.name === "AbortError") throw new Error("A resposta demorou demais.");
    throw erro;
  } finally {
    clearTimeout(prazo);
  }
}

/** Erro de API em português, porque ele vai ler isto no carro. */
function mensagemDeErro(status, corpo) {
  const detalhe = (() => {
    try {
      return JSON.parse(corpo)?.error?.message || "";
    } catch {
      return "";
    }
  })();

  if (status === 401) return "Chave recusada. Confira a chave do OpenRouter.";
  if (status === 402) return "Sem crédito no OpenRouter.";
  if (status === 404) return `Modelo não encontrado. ${detalhe}`.trim();
  if (status === 429) return "Muitas chamadas seguidas. Espere um pouco.";
  if (status >= 500) return "O OpenRouter está fora do ar agora.";
  return detalhe || `OpenRouter respondeu ${status}.`;
}

/* ------------------------------------------------------------ perguntas */

/**
 * Perguntas prontas. Existem porque digitar no carro é caro, e porque uma
 * pergunta boa vale mais que uma resposta boa.
 */
export const PERGUNTAS = [
  "O que mudou na minha última semana em relação à anterior?",
  "Em que faixa de horário eu estou ganhando menos por hora, e quanto menos?",
  "Para onde está indo meu dinheiro, e o que mais cresceu?",
  "Meu líquido está acompanhando o bruto, ou o custo está comendo mais?",
  "Tem algum dia da semana que não está se pagando?",
];
