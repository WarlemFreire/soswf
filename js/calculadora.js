/* =========================================================
   Calculadora de Ganhos em Apps — SOS WF
   Estima o lucro líquido dirigindo para apps de transporte,
   descontando combustível e os custos fixos do veículo.
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_KEY = "soswf-calc-ganhos";

  // Campos numéricos que entram no cálculo / são persistidos.
  var FIELDS = [
    "km-dia", "horas", "preco-comb", "consumo",
    "prestacao", "seguro", "ipva", "manutencao",
    "aluguel", "extras",
    "dias-semana", "dias-mes", "bruto-dia"
  ];

  var DIAS_UTEIS_MES = 21.7; // referência p/ aluguel (52 sem / 12 meses ≈ 4,33)
  var SEMANAS_MES = 52 / 12;

  var brl = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL"
  });

  function $(id) { return document.getElementById(id); }

  function num(id) {
    var v = parseFloat(($(id) && $(id).value || "").replace(",", "."));
    return isFinite(v) && v > 0 ? v : 0;
  }

  function getMode() {
    return document.body.getAttribute("data-mode") || "proprio";
  }

  /* -------------------- Cálculo -------------------- */
  function calcular() {
    var kmDia    = num("km-dia");
    var horas    = num("horas");
    var preco    = num("preco-comb");
    var consumo  = num("consumo");
    var diasSem  = num("dias-semana") || 1;
    var diasMes  = num("dias-mes") || 1;
    var brutoDia = num("bruto-dia");

    // Combustível por dia e por mês
    var combDia = consumo > 0 ? (kmDia / consumo) * preco : 0;
    var combMes = combDia * diasMes;

    // Custos fixos mensais do veículo
    var fixosMes;
    if (getMode() === "alugado") {
      fixosMes = num("aluguel") * SEMANAS_MES + num("extras");
    } else {
      fixosMes = num("prestacao") + num("seguro") + num("ipva") + num("manutencao");
    }

    var custoMes = combMes + fixosMes;
    var brutoMes = brutoDia * diasMes;

    // Custo médio por dia trabalhado (distribui os fixos pelos dias do mês)
    var custoDia = custoMes / diasMes;

    return {
      diasSem: diasSem,
      diasMes: diasMes,
      horasDia: horas,
      kmDia: kmDia,
      combDia: combDia,
      custoDia: custoDia,
      brutoDia: brutoDia,
      custoMes: custoMes,
      brutoMes: brutoMes
    };
  }

  /* -------------------- Escala por período -------------------- */
  function escala(r, periodo) {
    var fator, dias;
    switch (periodo) {
      case "dia":    fator = 1;            dias = 1;          break;
      case "semana": fator = r.diasSem;    dias = r.diasSem;  break;
      case "ano":    fator = r.diasMes*12; dias = r.diasMes*12; break;
      default:       fator = r.diasMes;    dias = r.diasMes;  break; // mês
    }
    var bruto = r.brutoDia * fator;
    var custo = r.custoDia * fator;
    return {
      dias: dias,
      bruto: bruto,
      custo: custo,
      liquido: bruto - custo,
      horas: r.horasDia * fator,
      km: r.kmDia * fator
    };
  }

  /* -------------------- Render -------------------- */
  function render() {
    var r = calcular();
    var periodo = $("periodo").value;
    var p = escala(r, periodo);

    var margem = p.bruto > 0 ? (p.liquido / p.bruto) * 100 : 0;
    var liqHora = p.horas > 0 ? p.liquido / p.horas : 0;
    var custoKm = p.km > 0 ? p.custo / p.km : 0;
    var metaDia = r.custoDia; // faturamento bruto diário para empatar

    $("out-custo").textContent = brl.format(p.custo);
    $("out-liquido-mini").textContent = brl.format(p.liquido);
    $("out-bruto").textContent = brl.format(p.bruto);
    $("out-liquido").textContent = brl.format(p.liquido);

    $("kpi-hora").textContent = brl.format(liqHora);
    $("kpi-km").textContent = brl.format(custoKm);
    $("kpi-margem").textContent = (margem >= 0 ? "+" : "") + margem.toFixed(1) + "%";
    $("kpi-breakeven").textContent = brl.format(metaDia);

    // cor do líquido conforme resultado
    var liqEls = [$("out-liquido"), $("out-liquido-mini")];
    liqEls.forEach(function (el) {
      el.style.color = p.liquido >= 0 ? "var(--profit)" : "var(--cost)";
    });
    $("kpi-margem").style.color = p.liquido >= 0 ? "var(--profit)" : "var(--cost)";

    // barra custo x lucro
    var total = p.custo + Math.max(p.liquido, 0);
    var custoPct = total > 0 ? (p.custo / total) * 100 : 100;
    var lucroPct = 100 - custoPct;
    $("bar-cost").style.width = custoPct + "%";
    $("bar-profit").style.width = lucroPct + "%";
    if (p.liquido < 0) {
      $("bar-cost").style.width = "100%";
      $("bar-profit").style.width = "0%";
    }

    renderResumo(p, periodo, margem, liqHora);
    salvar();
  }

  var NOME_PERIODO = { dia: "um dia", semana: "uma semana", mes: "um mês", ano: "um ano" };

  function renderResumo(p, periodo, margem, liqHora) {
    var nome = NOME_PERIODO[periodo] || "o período";
    var txt;
    if (p.liquido >= 0) {
      txt = "Em <strong>" + nome + "</strong>, com custo total de " +
        "<strong class='cost'>" + brl.format(p.custo) + "</strong> e faturamento de " +
        brl.format(p.bruto) + ", seu lucro líquido é de " +
        "<strong class='profit'>" + brl.format(p.liquido) + "</strong> (" +
        margem.toFixed(1) + "% de margem), o equivalente a " +
        "<strong>" + brl.format(liqHora) + "/hora</strong>.";
    } else {
      txt = "Atenção: em <strong>" + nome + "</strong> os custos (" +
        "<strong class='cost'>" + brl.format(p.custo) + "</strong>) superam o faturamento (" +
        brl.format(p.bruto) + "), gerando prejuízo de " +
        "<strong class='cost'>" + brl.format(Math.abs(p.liquido)) + "</strong>. " +
        "Aumente o faturamento diário ou reduza os custos do carro.";
    }
    $("summary-text").innerHTML = txt;
  }

  /* -------------------- Persistência -------------------- */
  function salvar() {
    try {
      var data = { mode: getMode(), periodo: $("periodo").value };
      FIELDS.forEach(function (id) { if ($(id)) data[id] = $(id).value; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignora storage indisponível */ }
  }

  function carregar() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!data) return;
      FIELDS.forEach(function (id) {
        if ($(id) && data[id] !== undefined) $(id).value = data[id];
      });
      if (data.periodo) $("periodo").value = data.periodo;
      if (data.mode) setMode(data.mode);
    } catch (e) { /* ignora dados corrompidos */ }
  }

  /* -------------------- Modo (próprio / alugado) -------------------- */
  function setMode(mode) {
    document.body.setAttribute("data-mode", mode);
    document.querySelectorAll(".mode-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-mode") === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  /* -------------------- Init -------------------- */
  function init() {
    setMode("proprio");
    carregar();

    document.querySelectorAll(".mode-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-mode"));
        render();
      });
    });

    FIELDS.forEach(function (id) {
      if ($(id)) $(id).addEventListener("input", render);
    });
    $("periodo").addEventListener("change", render);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
