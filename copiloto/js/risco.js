// risco.js — áreas que ele não quer pegar, casadas contra o texto da oferta.
//
// POR QUE POR NOME E NÃO POR RAIO NO MAPA. Marcar um círculo num mapa é o que
// parece certo, e não serve para decidir corrida: no instante da oferta o app
// sabe onde ELE está, não para onde a corrida vai. O destino existe na tela
// apenas como texto — bairro, rua, referência. Então é o texto que é casado.
// Um raio no mapa só responderia "estou numa área ruim agora", que é uma
// pergunta diferente e muito menos útil.
//
// A REGRA QUE FAZ ISSO SER USÁVEL: alarme falso mata o recurso. Se o app
// apitar em corrida boa, ele para de olhar o aviso — e aí o aviso verdadeiro
// também passa batido. Por isso o casamento é por palavra inteira, exige três
// letras e ignora acento e caixa. "Ana" não pode casar com "Cabana", e
// "Jardim" sozinho não pode marcar meia cidade.

/** Um termo curto demais casa com tudo. Três é o mínimo que ainda discrimina. */
const MINIMO_LETRAS = 3;

export const NIVEIS = [
  { id: "evitar", nome: "Não pegar", descricao: "Recusa mesmo que o valor esteja bom." },
  { id: "atencao", nome: "Atenção", descricao: "Avisa, mas quem decide é você." },
];

/**
 * Tira acento, caixa e pontuação, e separa em palavras.
 *
 * O motorista digita "Morro do Papagaio" e a tela da plataforma pode mostrar
 * "MORRO DO PAPAGAIO" ou "Morro do Papagaio - BH". Sem normalizar as duas
 * pontas, nenhuma das duas casaria.
 */
export function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Um termo vale se, normalizado, ainda tem letra suficiente para discriminar. */
export function termoValido(termo) {
  const limpo = normalizar(termo);
  return limpo.replace(/\s/g, "").length >= MINIMO_LETRAS;
}

/**
 * O termo aparece no texto como palavra (ou sequência de palavras) inteira?
 *
 * Casamento por substring simples daria "ana" dentro de "cabana". Aqui os dois
 * lados viram listas de palavras e a comparação é de sequência.
 */
export function casa(texto, termo) {
  const alvo = normalizar(termo);
  if (!alvo) return false;

  const palavrasTexto = normalizar(texto).split(" ").filter(Boolean);
  const palavrasTermo = alvo.split(" ").filter(Boolean);
  if (!palavrasTermo.length || palavrasTermo.length > palavrasTexto.length) return false;

  for (let i = 0; i <= palavrasTexto.length - palavrasTermo.length; i++) {
    let bate = true;
    for (let j = 0; j < palavrasTermo.length; j++) {
      if (palavrasTexto[i + j] !== palavrasTermo[j]) {
        bate = false;
        break;
      }
    }
    if (bate) return true;
  }
  return false;
}

/**
 * Quais áreas aparecem no texto da oferta.
 *
 * Devolve sempre uma lista, ordenada com "não pegar" na frente: se duas áreas
 * casam, é a mais grave que tem de aparecer no selo, que só tem espaço para uma.
 */
export function avaliar(texto, areas) {
  if (!texto) return [];

  const achadas = [];
  for (const area of areas || []) {
    if (area?.ativa === false) continue;
    const termos = (area?.termos || []).filter(termoValido);
    const casou = termos.find((t) => casa(texto, t));
    if (casou) achadas.push({ id: area.id, nome: area.nome, nivel: area.nivel || "atencao", termo: casou });
  }

  return achadas.sort((a, b) => (a.nivel === "evitar" ? -1 : 1) - (b.nivel === "evitar" ? -1 : 1));
}

/** A mais grave, que é a que cabe no selo. */
export function maisGrave(achadas) {
  return achadas?.[0] || null;
}

/** Limpa uma área vinda da tela antes de guardar. */
export function normalizarArea(area) {
  const termos = [...new Set((area?.termos || []).map((t) => String(t).trim()).filter(termoValido))];
  return {
    id: area?.id || `area-${Date.now().toString(36)}`,
    nome: String(area?.nome || "").trim() || "Sem nome",
    nivel: area?.nivel === "evitar" ? "evitar" : "atencao",
    ativa: area?.ativa !== false,
    termos,
  };
}

/**
 * O que vai para o serviço de acessibilidade. Só o necessário para casar:
 * nome (para o selo), nível e termos já normalizados, para o Java não precisar
 * repetir a normalização e arriscar divergir desta.
 */
export function paraOServico(areas) {
  return (areas || [])
    .filter((a) => a?.ativa !== false && (a?.termos || []).some(termoValido))
    .map((a) => ({
      nome: a.nome,
      nivel: a.nivel === "evitar" ? "evitar" : "atencao",
      termos: a.termos.filter(termoValido).map(normalizar),
    }));
}
