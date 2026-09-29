// semaforo.js — o lado JavaScript do semáforo de ofertas.
//
// A divisão de trabalho com o Java é deliberada:
//
//   AQUI mora a conta financeira. Os cortes saem da distribuição das ofertas
//   DELE mesmo, por faixa horária, e são testados no node junto com o resto.
//
//   LÁ mora só a comparação. O serviço de acessibilidade recebe os números
//   prontos, lê a tela e pinta o selo. Ele não calcula nada de dinheiro.
//
// Duplicar a conta nos dois lados criaria duas verdades que divergem na
// primeira correção — e a primeira correção deste projeto foi justamente no
// piso de aceite, duas vezes.
//
// A REGRA QUE NÃO PODE SER QUEBRADA: os cortes vêm da referência de CORRIDA
// OFERTADA (~3,4 a 3,8 R$/km), nunca das faixas da JORNADA (~1,9 R$/km, que
// contam km vazio). Misturar as duas escalas foi o que fez o app mandar recusar
// praticamente toda corrida. Ver faixas.js.
//
// E o piso é percentil BAIXO, não mediana: mediana reprova metade das ofertas
// por definição, que foi o outro erro da mesma história.

import { nativo } from "./plataforma.js";
import * as store from "./store.js";
import * as M from "./metrics.js";
import { custoTotalKm } from "./config.js";
import { db, novoId } from "./db.js";

function plugin() {
  return globalThis.Capacitor?.Plugins?.Semaforo ?? null;
}

export function disponivel() {
  return nativo() && Boolean(plugin());
}

/** O que o Android já autorizou, e se o semáforo está ligado. */
export async function estado() {
  if (!disponivel()) {
    return { suportado: false, acessibilidadeAtiva: false, podeSobrepor: false, ligado: false, temPisos: false };
  }
  const r = await plugin().estado();
  return { suportado: true, ...r };
}

/** Leva ele à tela do Android que concede a leitura de tela. */
export async function abrirAcessibilidade() {
  if (!disponivel()) return false;
  await plugin().abrirAjustesDeAcessibilidade();
  return true;
}

/** Leva ele à tela do Android que autoriza desenhar sobre outros apps. */
export async function abrirSobreposicao() {
  if (!disponivel()) return false;
  await plugin().abrirAjustesDeSobreposicao();
  return true;
}

export async function ligar(ligado) {
  if (!disponivel()) return false;
  await plugin().ligar({ ligado: Boolean(ligado) });
  if (ligado) await sincronizar();
  return true;
}

/**
 * Os cortes da faixa horária de agora.
 *
 * Devolve null quando não há amostra suficiente. Isso é o comportamento certo,
 * não uma falha: sem histórico medido o app não tem autoridade para mandar
 * recusar corrida, e o selo não aparece em vez de aparecer com cor chutada.
 */
export function cortesAgora(agora = Date.now(), { aceite, config } = {}) {
  const periodo = M.periodoDe(agora);
  const referencia = (aceite ?? store.referenciaDeAceite())?.[periodo];
  const hora = referencia?.hora;
  if (!hora || !(hora.piso > 0)) return null;

  const km = referencia?.km;
  return {
    periodo,
    pisoHora: hora.piso,
    idealHora: hora.ideal,
    otimoHora: hora.otimo,
    // O piso por km do semáforo é da OFERTA, não da jornada — por isso ele pode
    // existir aqui e não existir no piso de aceite da tela principal.
    pisoKm: km?.piso ?? 0,
    // Chão absoluto: abaixo do custo de rodar a corrida dá prejuízo, seja qual
    // for a hora. O único corte que não depende de histórico.
    custoKm: custoTotalKm(config ?? undefined) || 0,
  };
}

/** Manda os cortes para o serviço. Barato: é uma escrita em SharedPreferences. */
export async function sincronizar(agora = Date.now()) {
  if (!disponivel()) return false;
  const cortes = cortesAgora(agora);
  if (!cortes) {
    // Zerar é importante: sem isso o serviço seguiria julgando com o corte de
    // ontem depois de o usuário apagar os dados.
    await plugin().definirPisos({ pisoHora: 0, idealHora: 0, otimoHora: 0, pisoKm: 0, custoKm: 0, periodo: "" });
    return false;
  }
  await plugin().definirPisos(cortes);
  return true;
}

/**
 * Guarda cada oferta lida. É o registro de tudo que foi OFERECIDO, aceito ou
 * não — o único jeito de saber depois quanto ele recusou e se o semáforo estava
 * certo. Também é o que permite conferir a leitura de tela contra a realidade:
 * parser de tela erra, e erro que ninguém consegue auditar não se conserta.
 */
async function guardar(oferta) {
  const registro = {
    id: novoId(),
    timestamp: Number(oferta.quando) || Date.now(),
    jornadaId: store.jornadaAtiva()?.id ?? null,
    valor: Number(oferta.valor) || 0,
    km: Number(oferta.km) || 0,
    minutos: Number(oferta.minutos) || 0,
    reaisPorKm: Number(oferta.reaisPorKm) || 0,
    reaisPorHora: Number(oferta.reaisPorHora) || 0,
    veredito: String(oferta.veredito || ""),
    periodo: String(oferta.periodo || ""),
    // Preenchido a mão depois, quando ele quiser conferir se a leitura bateu.
    conferida: null,
  };
  await db.put("ofertas", registro);
  return registro;
}

let ligadoAoServico = false;

/**
 * Começa a ouvir. Idempotente: chamar duas vezes não duplica o ouvinte.
 *
 * Os cortes são re-enviados a cada mudança do store porque cada corrida nova
 * move a distribuição, e na virada de faixa horária porque o piso das 3h da
 * manhã não é o das 18h.
 */
export async function iniciar() {
  if (!disponivel() || ligadoAoServico) return false;
  ligadoAoServico = true;

  plugin().addListener("oferta", (oferta) => {
    guardar(oferta).catch(() => {
      /* sem banco a oferta se perde; o selo já apareceu, que é o que decide */
    });
  });

  await sincronizar();

  // Uma corrida nova muda a distribuição; a virada de período muda o corte.
  store.assinar(() => {
    sincronizar().catch(() => {});
  });
  setInterval(() => {
    sincronizar().catch(() => {});
  }, 300000);

  document.addEventListener("copiloto:config", () => {
    sincronizar().catch(() => {});
  });
  return true;
}

/** Ofertas do dia, para a tela mostrar o que foi oferecido e o que foi recusado. */
export async function ofertasDoDia(data = M.chaveData(Date.now())) {
  const todas = await db.todos("ofertas");
  return todas
    .filter((o) => M.chaveData(o.timestamp) === data)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Quanto foi oferecido, quanto o semáforo mandou recusar, e a soma de cada. */
export function resumoDeOfertas(ofertas) {
  const vazio = { total: 0, recusar: 0, fraca: 0, boa: 0, otima: 0, somaBoas: 0, somaRecusadas: 0 };
  if (!ofertas?.length) return vazio;

  return ofertas.reduce((r, o) => {
    r.total += 1;
    if (o.veredito in r) r[o.veredito] += 1;
    if (o.veredito === "recusar") r.somaRecusadas += o.valor;
    else r.somaBoas += o.valor;
    return r;
  }, { ...vazio });
}
