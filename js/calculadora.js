/* =========================================================
   Calculadora de Ganhos em Apps — SOS WF
   Estima o lucro líquido dirigindo para apps de transporte.

   Faturamento: estimado por DOIS caminhos (R$/km e R$/h);
   usa-se a MÉDIA dos que foram preenchidos. Se as duas
   estimativas divergem muito, avisa que os dados estão
   inconsistentes.

   Custos: comissão do app, combustível, pneu+depreciação
   por km, custos fixos e manutenção (destrinchada).
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_KEY = "soswf-calc-ganhos-v2";

  var FIELDS = [
    "km-dia", "horas", "preco-comb", "consumo",
    "ganho-km", "ganho-hora", "comissao",
    "prestacao", "seguro", "ipva",
    "manut-oleo", "manut-revisao", "manut-freios", "manut-outros", "pneu-km",
    "aluguel", "extras",
    "dias-semana", "dias-mes"
  ];

  var SEMANAS_MES = 52 / 12;

  var brl = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL"
  });

  function $(id) { return document.getElementById(id); }

  function num(id) {
    var el = $(id);
    if (!el) return 0;
    var v = parseFloat((el.value || "").replace(",", "."));
    return isFinite(v) && v > 0 ? v : 0;
  }

  function getMode() {
    return document.body.getAttribute("data-mode") || "proprio";
  }

  /* -------------------- Cálculo -------------------- */
  function calcular() {
    var km       = num("km-dia");
    var horas    = num("horas");
    var preco    = num("preco-comb");
    var consumo  = num("consumo");
    var ganhoKm  = num("ganho-km");
    var ganhoH   = num("ganho-hora");
    var comissao = num("comissao") / 100;
    var diasSem  = num("dias-semana") || 1;
    var diasMes  = num("dias-mes") || 1;

    // --- Faturamento bruto do dia: média das estimativas preenchidas ---
    var estKm = ganhoKm * km;     // estimativa pela rodagem
    var estH  = ganhoH * horas;   // estimativa pelas horas
    var partes = [];
    if (estKm > 0) partes.push(estKm);
    if (estH > 0) partes.push(estH);
    var brutoDia = partes.length
      ? partes.reduce(function (a, b) { return a + b; }, 0) / partes.length
      : 0;

    // divergência entre as duas estimativas (0 = idênticas)
    var divergencia = 0;
    if (estKm > 0 && estH > 0) {
      divergencia = Math.abs(estKm - estH) / Math.max(estKm, estH);
    }

    // --- Custos diários variáveis ---
    var combDia     = consumo > 0 ? (km / consumo) * preco : 0;
    var comissaoDia = brutoDia * comissao;
    var pneuDia     = num("pneu-km") * km;

    // --- Custos fixos mensais ---
    var fixosMes, manutMes;
    if (getMode() === "alugado") {
      fixosMes = num("aluguel") * SEMANAS_MES + num("extras");
      manutMes = 0;
      pneuDia = 0; // no aluguel, pneu/desgaste é por conta da locadora
    } else {
      fixosMes = num("prestacao") + num("seguro") + num("ipva");
      // itens de manutenção são informados por ANO -> rateia por mês
      var manutAno = num("manut-oleo") + num("manut-revisao") +
                     num("manut-freios") + num("manut-outros");
      manutMes = manutAno / 12;
    }

    var combMes     = combDia * diasMes;
    var comissaoMes = comissaoDia * diasMes;
    var pneuMes     = pneuDia * diasMes;
    var custoMes    = combMes + comissaoMes + pneuMes + fixosMes + manutMes;
    var brutoMes    = brutoDia * diasMes;
    var custoDia    = custoMes / diasMes;

    return {
      diasSem: diasSem, diasMes: diasMes, horasDia: horas, kmDia: km,
      estKm: estKm, estH: estH, brutoDia: brutoDia, divergencia: divergencia,
      custoDia: custoDia, custoMes: custoMes, brutoMes: brutoMes,
      partes: {
        comissao: comissaoMes, combustivel: combMes, pneu: pneuMes,
        fixos: fixosMes, manut: manutMes
      }
    };
  }

  /* -------------------- Escala por período -------------------- */
  function escala(r, periodo) {
    var fator;
    switch (periodo) {
      case "dia":    fator = 1;             break;
      case "semana": fator = r.diasSem;     break;
      case "ano":    fator = r.diasMes * 12; break;
      default:       fator = r.diasMes;     break;
    }
    var bruto = r.brutoDia * fator;
    var custo = r.custoDia * fator;
    return {
      bruto: bruto, custo: custo, liquido: bruto - custo,
      horas: r.horasDia * fator, km: r.kmDia * fator
    };
  }

  /* -------------------- Render -------------------- */
  function render() {
    var r = calcular();
    var periodo = $("periodo").value;
    var p = escala(r, periodo);

    var margem  = p.bruto > 0 ? (p.liquido / p.bruto) * 100 : 0;
    var liqHora = p.horas > 0 ? p.liquido / p.horas : 0;
    var custoKm = p.km > 0 ? p.custo / p.km : 0;

    // Estimativa de faturamento (sempre em base diária)
    $("est-media").textContent = brl.format(r.brutoDia);
    $("est-km").textContent = r.estKm > 0 ? brl.format(r.estKm) : "—";
    $("est-hora").textContent = r.estH > 0 ? brl.format(r.estH) : "—";

    var warn = $("est-warn");
    if (r.divergencia >= 0.2) {
      var maior = r.estKm > r.estH ? "km" : "hora";
      warn.textContent = "As estimativas por km e por hora estão " +
        Math.round(r.divergencia * 100) + "% diferentes — provavelmente um " +
        "dos valores não condiz com a realidade (o por " + maior + " está " +
        "puxando pra cima). Ajuste para elas ficarem próximas.";
      warn.classList.add("show");
    } else {
      warn.classList.remove("show");
    }

    $("out-custo").textContent = brl.format(p.custo);
    $("out-liquido-mini").textContent = brl.format(p.liquido);
    $("out-bruto").textContent = brl.format(p.bruto);
    $("out-liquido").textContent = brl.format(p.liquido);

    $("kpi-hora").textContent = brl.format(liqHora);
    $("kpi-km").textContent = brl.format(custoKm);
    $("kpi-margem").textContent = (margem >= 0 ? "+" : "") + margem.toFixed(1) + "%";
    $("kpi-breakeven").textContent = brl.format(r.custoDia);

    // detalhamento de custos (mês)
    $("d-comissao").textContent = brl.format(r.partes.comissao);
    $("d-combustivel").textContent = brl.format(r.partes.combustivel);
    $("d-pneu").textContent = brl.format(r.partes.pneu);
    $("d-fixos").textContent = brl.format(r.partes.fixos);
    $("d-manut").textContent = brl.format(r.partes.manut);
    $("d-total").textContent = brl.format(r.custoMes);

    // cor do líquido
    var liqColor = p.liquido >= 0 ? "var(--profit)" : "var(--cost)";
    $("out-liquido").style.color = liqColor;
    $("out-liquido-mini").style.color = liqColor;
    $("kpi-margem").style.color = liqColor;

    // barra custo x lucro
    var total = p.custo + Math.max(p.liquido, 0);
    var custoPct = total > 0 ? (p.custo / total) * 100 : 100;
    if (p.liquido < 0) { custoPct = 100; }
    $("bar-cost").style.width = custoPct + "%";
    $("bar-profit").style.width = (100 - custoPct) + "%";

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
        "<strong class='cost'>" + brl.format(Math.abs(p.liquido)) + "</strong>.";
    }
    $("summary-text").innerHTML = txt;
  }

  /* -------------------- Persistência -------------------- */
  function salvar() {
    try {
      var data = { mode: getMode(), periodo: $("periodo").value };
      FIELDS.forEach(function (id) { if ($(id)) data[id] = $(id).value; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* storage indisponível */ }
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
    } catch (e) { /* dados corrompidos */ }
  }

  /* -------------------- Modo -------------------- */
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
