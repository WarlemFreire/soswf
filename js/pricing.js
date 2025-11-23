// ============================
// PRICING.JS - CONFIGURAÇÃO GERAL
// ============================

// Carrega do admin ou usa padrão
const PRICING_VERSION = "v3-higienizacao-localidade";

const DEFAULT_PRICES = {
  cardFee: 0.0449,          // juros mensal do cartão
  maxInstallments: 12,      // máximo permitido
  minInstallmentValue: 100, // parcela mínima
  pixDiscount: 0.10,        // 10% off no PIX

  installation: {
    "7.500 BTUs": 450,
    "9.000 BTUs": 500,
    "12.000 BTUs": 600,
    "18.000 BTUs": 750,
    "24.000 BTUs": 900,
    "Não informado": 450
  },

  installLocalAddons: {
    "Casa térrea": 0,
    "Varanda de apartamento": 80,
    "Fachada / altura": 150,
    "Comércio ou área ampla": 120
  },

  locationAddons: {
    "Baixada Fluminense": {
      "Belford Roxo": 0,
      "Duque de Caxias": 0,
      "Guapimirim": 0,
      "Itaguaí": 0,
      "Japeri": 0,
      "Magé": 0,
      "Mesquita": 0,
      "Nilópolis": 0,
      "Nova Iguaçu": 0,
      "Paracambi": 0,
      "Queimados": 0,
      "São João de Meriti": 0,
      "Seropédica": 0
    },
    "Rio Capital": {
      "Centro": 0,
      "Zona Sul": 0,
      "Tijuca e região": 0,
      "Zona Norte": 0,
      "Jacarepaguá e região": 0,
      "Bangu e região": 0,
      "Barra da Tijuca": 0,
      "Recreio dos Bandeirantes": 0
    },
    "Região Serrana": {
      "Petrópolis": 0,
      "Teresópolis": 0,
      "Nova Friburgo": 0,
      "Outros da Região Serrana": 0
    }
  },

  cleaningMethods: {
    "Higienização com bolsa": 220,
    "Higienização completa": 320
  },

  maintenance: {
    visit: 120,
    visitAddon: 0
  }
};

function mergeConfig(parsed) {
  const data = parsed || {};

  const cleaningMethods = data.cleaningMethods || {
    "Higienização com bolsa":
      data.cleaningMethods?.["Limpeza com bolsa coletora"] ||
      data.cleaning?.["Uso frequente"] ??
      DEFAULT_PRICES.cleaningMethods["Higienização com bolsa"],
    "Higienização completa":
      data.cleaningMethods?.["Limpeza completa"] ||
      data.cleaning?.["Nunca fiz"] ??
      DEFAULT_PRICES.cleaningMethods["Higienização completa"]
  };

  // Se o admin salvou apenas interestRate (em %), converte para cardFee
  const cardFee =
    data.cardFee ??
    (data.interestRate !== undefined ? Number(data.interestRate) / 100 : DEFAULT_PRICES.cardFee);

  return {
    ...DEFAULT_PRICES,
    ...data,
    cardFee,
    pixDiscount: data.pixDiscount ?? DEFAULT_PRICES.pixDiscount,
    installation: {
      ...DEFAULT_PRICES.installation,
      ...(data.installation || {})
    },
    installLocalAddons: {
      ...DEFAULT_PRICES.installLocalAddons,
      ...(data.installLocalAddons || {})
    },
    cleaningMethods,
    locationAddons: Object.entries(DEFAULT_PRICES.locationAddons).reduce((acc, [region, subzones]) => {
      acc[region] = {
        ...subzones,
        ...(data.locationAddons?.[region] || {})
      };
      return acc;
    }, {}),
    maintenance: {
      ...DEFAULT_PRICES.maintenance,
      ...(data.maintenance || {})
    }
  };
}

function loadPricingConfig() {
  let parsed = null;

  try {
    parsed = JSON.parse(localStorage.getItem("SOSWF_PRICING"));
  } catch (e) {
    localStorage.removeItem("SOSWF_PRICING");
  }

  const validStored = parsed && parsed.version === PRICING_VERSION;
  const config = mergeConfig(validStored ? parsed : null);

  if (!validStored) {
    localStorage.setItem("SOSWF_PRICING", JSON.stringify({ ...config, version: PRICING_VERSION }));
  }

  return { ...config, version: PRICING_VERSION };
}

const PRICES = loadPricingConfig();

console.log("pricing.js carregado");
window.PRICING_VERSION = PRICING_VERSION;

// ============================
// CÁLCULO DE PARCELAMENTO REAL (com juros do cartão)
// ============================

function calculateBestInstallment(price) {
  const rate = PRICES.cardFee;
  const maxN = PRICES.maxInstallments;
  const minParcel = PRICES.minInstallmentValue;

  let chosenN = 1;
  let finalTotal = price;

  // fórmula PRICE
  function parcelaMensal(P, i, n) {
    return (P * i * Math.pow(1 + i, n)) /
           (Math.pow(1 + i, n) - 1);
  }

  for (let n = maxN; n >= 1; n--) {
    const parcela = parcelaMensal(price, rate, n);

    if (parcela >= minParcel) {
      chosenN = n;
      finalTotal = parcela * n;
      break;
    }
  }

  return {
    n: chosenN,
    total: Math.round(finalTotal)
  };
}

// ============================
// FORMATAÇÃO DO TEXTO PARA TELA
// ============================

function formatMoney(value) {
  return value.toFixed(2).replace(".", ",");
}

function getPaymentText(basePrice) {
  const parc = calculateBestInstallment(basePrice);
  const installmentValue = parc.total / parc.n;
  // Preço base já está com desconto embutido; não aplicar novo desconto no Pix
  const pixValue = basePrice;

  return {
    n: parc.n,
    installmentValue: formatMoney(installmentValue),
    cardTotal: formatMoney(parc.total),
    pixValue: formatMoney(pixValue),
    baseValue: formatMoney(basePrice),
    cardText: `R$ ${formatMoney(installmentValue)} em ${parc.n}x (total R$ ${formatMoney(parc.total)})`,
    pixText: `R$ ${formatMoney(pixValue)} no dinheiro ou pix`
  };
}

// Disponível globalmente
window.getPaymentText = getPaymentText;
window.PRICES = PRICES;
