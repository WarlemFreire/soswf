// roteiros.js — as etapas de cada servico. So dados + regras; o motor executa.
//
// Campo: { id, tipo: foto|numero|texto|check|escolha|assinatura, rotulo,
//          unidade?, opcoes?, obrigatorio? (padrao true), liberaApos? }
// Etapa: { id, titulo, instrucao, depende: [ids], campos, avaliar?(v, os, cfg, dados) }

import * as C from "./calculos.js";

const foto = (id, rotulo, extra = {}) => ({ id, tipo: "foto", rotulo, ...extra });
const numero = (id, rotulo, unidade, extra = {}) => ({ id, tipo: "numero", rotulo, unidade, ...extra });
const texto = (id, rotulo, extra = {}) => ({ id, tipo: "texto", rotulo, ...extra });
const check = (id, rotulo) => ({ id, tipo: "check", rotulo });
const escolha = (id, rotulo, opcoes, extra = {}) => ({ id, tipo: "escolha", rotulo, opcoes, ...extra });

const TENSOES = ["127", "220"];
const BTUS = ["7.500", "9.000", "12.000", "18.000", "24.000", "30.000+"];

// Dados da etiqueta ficam na vistoria; as medicoes finais comparam contra eles.
function nominal(os, campo) {
  return os.etapas?.vistoria?.dados?.[campo]?.v;
}

// ---------- etapas reutilizadas ----------

function vistoria({ comLocal }) {
  return {
    id: "vistoria",
    titulo: "Vistoria inicial",
    instrucao:
      "Registre o estado ANTES de tocar em qualquer coisa. Avaria já existente " +
      "fotografada aqui não vira culpa do serviço.",
    depende: [],
    campos: [
      foto("foto_aparelho", "Aparelho / estado atual (avarias prévias)"),
      ...(comLocal
        ? [foto("foto_local_evap", "Local da evaporadora"), foto("foto_local_cond", "Local da condensadora")]
        : []),
      foto("foto_etiqueta", "Etiqueta do equipamento"),
      escolha("tensao_nominal", "Tensão nominal (etiqueta)", TENSOES),
      numero("corrente_nominal", "Corrente nominal (etiqueta)", "A"),
      foto("foto_quadro", "Quadro / disjuntor do circuito"),
      escolha("eletrica_ok", "Elétrica do cliente adequada?", ["Sim", "Não", "Não deu para verificar"]),
      texto("obs_vistoria", "Observações", { obrigatorio: false }),
    ],
  };
}

function medicoesFinais(id, titulo, depende, { comDeltaT = true, extras = [] } = {}) {
  return {
    id,
    titulo,
    instrucao:
      "Ligue no frio máximo e tire a foto de início. As medições só liberam " +
      "depois do tempo mínimo funcionando.",
    depende,
    campos: [
      foto("foto_ligado", "Aparelho ligado (início da contagem)"),
      ...[
        numero("tensao", "Tensão medida", "V"),
        numero("corrente", "Corrente medida", "A"),
        foto("foto_alicate", "Alicate na leitura de corrente"),
        ...(comDeltaT
          ? [
              numero("t_retorno", "Temperatura do retorno", "°C"),
              numero("t_insuflamento", "Temperatura do insuflamento", "°C"),
              foto("foto_termometro", "Termômetro no insuflamento"),
            ]
          : []),
        ...extras,
      ].map((c) => ({ ...c, liberaApos: { campo: "foto_ligado", minutos: (cfg) => cfg.operacaoMinutos } })),
    ],
    avaliar(v, os, cfg) {
      const falhas = [
        ...C.checarTensao(v.tensao, nominal(os, "tensao_nominal"), cfg.tensaoTolPct),
        ...C.checarCorrente(v.corrente, nominal(os, "corrente_nominal")),
      ];
      if (comDeltaT) falhas.push(...C.checarDeltaT(v.t_retorno, v.t_insuflamento, cfg.deltaT.min, cfg.deltaT.max).falhas);
      return falhas;
    },
  };
}

function testeDreno(id, depende) {
  return {
    id,
    titulo: "Teste do dreno com água",
    instrucao:
      "Despeje água na bandeja da evaporadora e confirme a saída livre no " +
      "ponto final, sem pingar na evaporadora.",
    depende,
    campos: [
      foto("foto_agua", "Água sendo despejada na bandeja"),
      foto("foto_saida", "Água saindo no ponto final do dreno"),
      check("escoou", "Escoou totalmente, sem pingar na evaporadora"),
    ],
  };
}

function entrega(depende) {
  return {
    id: "entrega",
    titulo: "Entrega ao cliente",
    instrucao: "Mostre o funcionamento, passe as orientações e colete a assinatura.",
    depende,
    campos: [
      texto("recebedor", "Nome de quem recebeu"),
      check("orientado", "Cliente orientado (uso, limpeza de filtro, garantia)"),
      { id: "assinatura", tipo: "assinatura", rotulo: "Assinatura do cliente" },
    ],
  };
}

function diagnostico(depende, { comOrcamento = true } = {}) {
  return [
    {
      id: "diagnostico",
      titulo: "Diagnóstico",
      instrucao: "Conclusão baseada nas medições iniciais. Fotografe a evidência do defeito.",
      depende,
      campos: [
        texto("defeito", "Defeito encontrado"),
        texto("causa", "Causa provável"),
        foto("foto_defeito", "Evidência do defeito"),
      ],
    },
    ...(comOrcamento
      ? [
          {
            id: "orcamento",
            titulo: "Orçamento e aceite",
            instrucao: "Valor apresentado ao cliente antes de executar.",
            depende: ["diagnostico"],
            campos: [
              texto("servico_proposto", "Serviço proposto"),
              numero("valor_orcado", "Valor orçado", "R$"),
              escolha("aceite", "Cliente aprovou?", ["Sim", "Não"]),
            ],
            avaliar: (v) => (v.aceite === "Sim" ? [] : ["Cliente não aprovou o orçamento"]),
          },
        ]
      : []),
    {
      id: "execucao",
      titulo: "Execução",
      instrucao: "O que foi feito, com foto das peças trocadas/serviço realizado.",
      depende: [comOrcamento ? "orcamento" : "diagnostico"],
      campos: [
        texto("realizado", "Serviço realizado"),
        foto("foto_execucao_1", "Serviço / peça"),
        foto("foto_execucao_2", "Serviço / peça (2)", { obrigatorio: false }),
      ],
    },
  ];
}

// ---------- roteiros ----------

const instalacao = {
  id: "instalacao",
  nome: "Instalação de split",
  etapas: [
    vistoria({ comLocal: true }),
    {
      // Fixacao e furacao podem ser feitas em qualquer ordem: as duas dependem
      // so da vistoria, e a tubulacao espera as duas.
      id: "fixacao_evap",
      titulo: "Fixação da evaporadora",
      instrucao: "Nível de bolha sobre a evaporadora, com leve caimento para o lado do dreno.",
      depende: ["vistoria"],
      campos: [
        foto("foto_placa", "Placa/suporte fixado"),
        foto("foto_nivel", "Nível de bolha sobre a evaporadora"),
        check("caimento_dreno", "Caimento para o lado do dreno conferido"),
      ],
    },
    {
      id: "furo_cond",
      titulo: "Furo/passagem e condensadora",
      instrucao: "Furo com caimento para fora; condensadora fixada e nivelada, com coxins.",
      depende: ["vistoria"],
      campos: [
        foto("foto_furo", "Furo / passagem"),
        foto("foto_cond", "Condensadora fixada no suporte"),
        check("coxins", "Coxins/amortecedores instalados e parafusos apertados"),
      ],
    },
    {
      id: "tubulacao",
      titulo: "Tubulação e flanges",
      instrucao: "Corte com cortador, rebarba removida, flange com óleo, isolamento contínuo.",
      depende: ["fixacao_evap", "furo_cond"],
      campos: [
        numero("comprimento", "Comprimento da linha", "m"),
        foto("foto_tubulacao", "Tubulação isolada e fixada"),
        check("flanges_ok", "Flanges sem trinca/rebarba, porcas apertadas"),
      ],
    },
    {
      id: "nitrogenio",
      titulo: "Estanqueidade com nitrogênio",
      instrucao:
        "Pressurize na pressão do manual. Fotografe manômetro e termômetro no " +
        "início. O fim só libera após o tempo mínimo; a queda é corrigida pela temperatura.",
      depende: ["tubulacao"],
      campos: [
        numero("p_ini", "Pressão inicial", "psi"),
        numero("t_ini", "Temperatura ambiente inicial", "°C"),
        foto("foto_ini", "Manômetro + termômetro no início"),
        ...[
          numero("p_fim", "Pressão final", "psi"),
          numero("t_fim", "Temperatura ambiente final", "°C"),
          foto("foto_fim", "Manômetro + termômetro no fim"),
        ].map((c) => ({ ...c, liberaApos: { campo: "foto_ini", minutos: (cfg) => cfg.nitrogenio.minutos } })),
      ],
      avaliar(v, os, cfg, dados) {
        return C.testeNitrogenio({
          pIni: v.p_ini,
          pFim: v.p_fim,
          tIni: v.t_ini,
          tFim: v.t_fim,
          minutos: C.minutosEntre(dados.foto_ini?.ts, dados.foto_fim?.ts),
          resolucao: cfg.nitrogenio.resolucaoPsi,
          minutosMin: cfg.nitrogenio.minutos,
        }).falhas;
      },
    },
    {
      id: "vacuo",
      titulo: "Vácuo",
      instrucao:
        "Atinja o alvo, fotografe o vacuômetro e feche o manifold. A leitura " +
        "final só libera após o tempo isolado.",
      depende: ["nitrogenio"],
      campos: [
        numero("micron_atingido", "Vácuo atingido", "mícron"),
        foto("foto_atingido", "Vacuômetro no alvo (manifold sendo fechado)"),
        ...[
          numero("micron_final", "Vácuo após isolado", "mícron"),
          foto("foto_final", "Vacuômetro após o tempo isolado"),
        ].map((c) => ({ ...c, liberaApos: { campo: "foto_atingido", minutos: (cfg) => cfg.vacuo.minutos } })),
      ],
      avaliar(v, os, cfg, dados) {
        return C.testeVacuo({
          micronAtingido: v.micron_atingido,
          micronFinal: v.micron_final,
          minutos: C.minutosEntre(dados.foto_atingido?.ts, dados.foto_final?.ts),
          alvo: cfg.vacuo.alvo,
          limite: cfg.vacuo.limite,
          minutosMin: cfg.vacuo.minutos,
        }).falhas;
      },
    },
    {
      id: "liberacao",
      titulo: "Liberação do gás",
      instrucao: "Abra totalmente as válvulas de serviço e recoloque as tampas.",
      depende: ["vacuo"],
      campos: [
        foto("foto_valvulas", "Válvulas abertas"),
        check("tampas", "Válvulas totalmente abertas e tampas recolocadas"),
      ],
    },
    {
      id: "eletrica",
      titulo: "Elétrica e comunicação",
      instrucao: "Bornes apertados, cabo de comunicação conferido nos dois lados.",
      depende: ["liberacao"],
      campos: [
        foto("foto_borne_evap", "Ligações na evaporadora"),
        foto("foto_borne_cond", "Ligações na condensadora"),
        check("comunicacao", "Comunicação e terra conferidos"),
      ],
    },
    testeDreno("dreno", ["eletrica"]),
    medicoesFinais("operacao", "Funcionamento e medições", ["dreno"]),
    {
      id: "bolha",
      titulo: "Teste de bolha nas porcas",
      instrucao:
        "Com o sistema funcionando, espuma em TODAS as porcas (evaporadora e " +
        "condensadora). Aguarde e observe.",
      depende: ["operacao"],
      campos: [
        foto("foto_bolha_evap", "Espuma nas porcas da evaporadora"),
        foto("foto_bolha_cond", "Espuma nas porcas da condensadora"),
        check("sem_bolha", "Nenhuma bolha em nenhuma porca"),
      ],
    },
    {
      id: "limpeza",
      titulo: "Limpeza e fotos finais",
      instrucao: "Local limpo, acabamento conferido.",
      depende: ["bolha"],
      campos: [
        foto("foto_final_evap", "Evaporadora instalada"),
        foto("foto_final_cond", "Condensadora instalada"),
        foto("foto_final_local", "Local limpo"),
      ],
    },
    entrega(["limpeza"]),
  ],
};

const higienizacao = {
  id: "higienizacao",
  nome: "Higienização de split",
  etapas: [
    vistoria({ comLocal: false }),
    {
      ...medicoesFinais("medicao_antes", "ΔT antes da limpeza", ["vistoria"]),
      // Antes da limpeza so registra: o ponto e comparar com o depois.
      avaliar: undefined,
    },
    {
      id: "fotos_antes",
      titulo: "Fotos antes",
      instrucao: "Mesmo ângulo que será usado nas fotos depois.",
      depende: ["medicao_antes"],
      campos: [foto("foto_serpentina_antes", "Serpentina antes"), foto("foto_turbina_antes", "Turbina antes")],
    },
    {
      id: "limpeza_h",
      titulo: "Limpeza",
      instrucao: "Proteção da parede/eletrônica, produto, enxágue.",
      depende: ["fotos_antes"],
      campos: [
        check("protecao", "Placa e parede protegidas"),
        foto("foto_limpeza", "Durante a limpeza"),
      ],
    },
    {
      id: "fotos_depois",
      titulo: "Fotos depois",
      instrucao: "Mesmo ângulo das fotos antes.",
      depende: ["limpeza_h"],
      campos: [foto("foto_serpentina_depois", "Serpentina depois"), foto("foto_turbina_depois", "Turbina depois")],
    },
    testeDreno("dreno", ["fotos_depois"]),
    medicoesFinais("operacao", "ΔT e medições depois", ["dreno"]),
    entrega(["operacao"]),
  ],
};

const manutencaoSplit = {
  id: "manutencao",
  nome: "Manutenção de split",
  etapas: [
    vistoria({ comLocal: false }),
    {
      ...medicoesFinais("medicao_ini", "Medições iniciais (roteiro fixo)", ["vistoria"], {
        extras: [numero("p_succao", "Pressão de sucção", "psi", { obrigatorio: false })],
      }),
      // Aparelho com defeito: medicao inicial so registra, nao reprova.
      avaliar: undefined,
    },
    ...diagnostico(["medicao_ini"]),
    medicoesFinais("operacao", "Medições finais", ["execucao"]),
    entrega(["operacao"]),
  ],
};

const tempsGeladeira = [
  numero("t_refrigerador", "Temperatura do refrigerador", "°C"),
  numero("t_freezer", "Temperatura do freezer", "°C"),
];

const manutencaoGeladeira = {
  id: "geladeira",
  nome: "Manutenção de geladeira",
  etapas: [
    vistoria({ comLocal: false }),
    {
      ...medicoesFinais("medicao_ini", "Medições iniciais (roteiro fixo)", ["vistoria"], {
        comDeltaT: false,
        extras: tempsGeladeira,
      }),
      avaliar: undefined,
    },
    ...diagnostico(["medicao_ini"]),
    // Temperatura interna da geladeira leva horas para estabilizar: e
    // registrada, mas so tensao e corrente reprovam na entrega.
    medicoesFinais("operacao", "Medições finais", ["execucao"], { comDeltaT: false, extras: tempsGeladeira }),
    entrega(["operacao"]),
  ],
};

export const ROTEIROS = {
  instalacao,
  higienizacao,
  manutencao: manutencaoSplit,
  geladeira: manutencaoGeladeira,
};

export const BTU_OPCOES = BTUS;
