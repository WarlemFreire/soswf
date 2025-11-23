// ===============================
// APP.JS - FLUXOS DO ASSISTENTE
// ===============================

document.addEventListener("DOMContentLoaded", () => {

  const BUILD_VERSION = "Build v4 sincronizado no Git (higienização e localidade)";

  const buildLabel = document.getElementById("build-version");
  if (buildLabel) buildLabel.textContent = BUILD_VERSION;

  const configLabel = document.getElementById("config-version");
  if (configLabel && window.PRICING_VERSION) {
    configLabel.textContent = `Tabela de preços ${window.PRICING_VERSION} carregada do Git.`;
  }

  // ==========================
  // ESTADOS GLOBAIS
  // ==========================
  let selectedService = null;
  let selectedBTU = null;
  let selectedLocal = null;
  let selectedRegion = null;
  let selectedZone = null;

  let locationNextScreen = null;
  let locationBackScreen = null;
  let locationAfterSelect = null;

  let hiBTU = null;
  let hiLastClean = null;
  let hiMethod = null;

  let maDevice = null;
  let maStatus = null;

  let osType = null;
  let osDesc = "";

  let installPayInfo = null;
  let hiPayInfo = null;

  const backToStartBtn = document.getElementById("back-to-start");

  function getLocationAddon() {
    if (!selectedRegion || !selectedZone) return 0;
    return PRICES.locationAddons?.[selectedRegion]?.[selectedZone] || 0;
  }

  function applyTheme(serviceName) {
    const s = (serviceName || "").toLowerCase();
    if (s.includes("instala")) document.body.dataset.theme = "install";
    else if (s.includes("higien")) document.body.dataset.theme = "clean";
    else if (s.includes("manuten")) document.body.dataset.theme = "maint";
    else document.body.dataset.theme = "other";
  }



  // ==========================
  // TROCA DE TELA
  // ==========================
  function goToScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("screen-active"));
    document.getElementById(id)?.classList.add("screen-active");

    if (id === "screen-t1") {
      backToStartBtn.classList.add("hidden");
      document.body.dataset.theme = "";
    } else {
      backToStartBtn.classList.remove("hidden");
    }

    if (id === "screen-hi-t3") {
      prepareHiStep();
    }
  }

  backToStartBtn.addEventListener("click", () => goToScreen("screen-t1"));



  // ==========================
  // T1 - ESCOLHA DO SERVIÇO
  // ==========================
  function resetHiFlow() {
    hiBTU = null;
    hiLastClean = null;
    hiMethod = null;
    highlightHiLast(null);
    highlightHiMethod(null);
    updateRecommendedBadge(true);
    setHiMethodsVisibility(false);
  }

  document.querySelectorAll(".card-service").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedService = btn.dataset.service;
      selectedRegion = null;
      selectedZone = null;
      selectedLocal = null;
      resetHiFlow();
      const s = selectedService.toLowerCase();
      applyTheme(selectedService);

      if (s.includes("instala")) goToScreen("screen-t2");
      else if (s.includes("higien")) goToScreen("screen-t2");
      else if (s.includes("manuten")) goToScreen("screen-ma-t2");
      else goToScreen("screen-os-t2");
    });
  });



  // ==========================
  // T2 - BTUs (instala + higienização)
  // ==========================
  document.querySelectorAll(".card-btu").forEach(btn => {
    btn.addEventListener("click", () => {

      selectedBTU = btn.dataset.btu;

      if (selectedService.toLowerCase().includes("higien")) {
        hiBTU = selectedBTU;
        openLocationStep({ nextScreen: "screen-hi-t3", backScreen: "screen-t2" });

      } else {
        openLocationStep({ nextScreen: "screen-t3", backScreen: "screen-t2" });
      }
    });
  });



  // ==========================
  // INSTALAÇÃO - T3 (LOCAL)
  // ==========================
  document.querySelectorAll(".card-local").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedLocal = btn.dataset.local;
      openInstallationSummary();
    });
  });


  // ==========================
  // LOCALIDADE (instala + higienização + manutenção)
  // ==========================
  const regionToggles = document.querySelectorAll(".card-region");
  const subzonePanels = document.querySelectorAll(".subzone-grid");

  function activateRegion(regionName) {
    regionToggles.forEach(b => b.classList.toggle("active", b.dataset.region === regionName));
    subzonePanels.forEach(panel => {
      const matches = panel.dataset.region === regionName;
      panel.classList.toggle("active", matches);
    });
  }

  function openLocationStep({ nextScreen, backScreen, afterSelect }) {
    locationNextScreen = nextScreen;
    locationBackScreen = backScreen;
    locationAfterSelect = afterSelect || null;
    const target = selectedRegion || regionToggles[0]?.dataset.region;
    if (target) activateRegion(target);
    goToScreen("screen-location");
  }

  regionToggles.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetRegion = btn.dataset.region;
      activateRegion(targetRegion);
    });
  });

  document.querySelectorAll(".card-subzone").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedRegion = btn.dataset.region;
      selectedZone = btn.dataset.subzone;

      if (locationAfterSelect) {
        locationAfterSelect();
      } else if (locationNextScreen) {
        goToScreen(locationNextScreen);
      }
    });
  });

  document.getElementById("location-back")?.addEventListener("click", () => {
    if (locationBackScreen) {
      goToScreen(locationBackScreen);
    } else {
      goToScreen("screen-t1");
    }
  });


  // ==========================
  // INSTALAÇÃO - RESUMO + PAG.
  // ==========================
  function openInstallationSummary() {

    document.getElementById("summary-service").textContent = selectedService;
    document.getElementById("summary-btu").textContent = selectedBTU;
    document.getElementById("summary-local").textContent = selectedLocal;
    document.getElementById("summary-location").textContent = selectedZone;

    const base = PRICES.installation[selectedBTU] || 450;
    const addon = PRICES.installLocalAddons[selectedLocal] || 0;
    const finalPrice = base + addon + getLocationAddon();

    // Pagamento
    const pay = getPaymentText(finalPrice);
    installPayInfo = pay;

    document.getElementById("install-parc-n").textContent = pay.n;
    document.getElementById("install-parc-value").textContent = pay.installmentValue;
    document.getElementById("install-card-total").textContent =
      `Total no cartão: R$ ${pay.cardTotal}`;
    document.getElementById("install-pix").textContent =
      `R$ ${pay.pixValue} no dinheiro ou pix`;

    goToScreen("screen-t4");
  }



  // ==========================
  // T4 -> T5 (agendamento)
  // ==========================
  document.getElementById("go-to-t5")?.addEventListener("click", () => goToScreen("screen-t5"));
  document.getElementById("back-to-t4")?.addEventListener("click", () => goToScreen("screen-t4"));
  document.getElementById("back-to-t3")?.addEventListener("click", () => goToScreen("screen-t3"));
  document.getElementById("hi-back-t4")?.addEventListener("click", () => goToScreen("screen-hi-t3"));
  document.getElementById("ma-back-t4")?.addEventListener("click", () => goToScreen("screen-ma-t3"));
  document.getElementById("os-back-t2")?.addEventListener("click", () => goToScreen("screen-os-t2"));



  // ==========================
  // WHATSAPP - INSTALAÇÃO
  // ==========================
  document.getElementById("whatsapp-flow")?.addEventListener("click", () => {

    const installEstimate = installPayInfo?.baseValue || "";

    const msg = encodeURIComponent(
`Olá! Fiz o pré-orçamento de INSTALAÇÃO:

- Serviço: ${selectedService}
- BTU: ${selectedBTU}
- Local: ${selectedLocal}
- Localidade: ${selectedRegion} - ${selectedZone}
- Valor estimado: R$ ${installEstimate}

Agendamento:
- Nome: ${document.getElementById("client-name").value}
- Bairro: ${document.getElementById("client-bairro").value}
- Dia: ${document.getElementById("client-date").value}`
    );

    window.location.href = `https://wa.me/5521975232241?text=${msg}`;
  });




  // ======================================
  // HIGIENIZAÇÃO - T3 (Última Limpeza)
  // ======================================
  const hiMethodsSection = document.getElementById("hi-methods");
  const hiBadges = {
    bolsa: document.querySelector('[data-badge="bolsa"]'),
    completa: document.querySelector('[data-badge="completa"]')
  };
  const hiMethodCards = document.querySelectorAll(".method-card");

  function highlightHiLast(value) {
  document.querySelectorAll(".card-hi-last").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.hi === value);
    });
  }

  function highlightHiMethod(value) {
    document.querySelectorAll(".method-card").forEach(card => {
      card.classList.toggle("active", card.dataset.method === value);
    });
  }

  function setHiMethodsVisibility(show) {
    if (hiMethodsSection) hiMethodsSection.classList.toggle("hidden", !show);
    hiMethodCards.forEach(card => {
      const isDisabled = !show;
      card.setAttribute("aria-disabled", isDisabled ? "true" : "false");
      card.tabIndex = isDisabled ? -1 : 0;
      card.classList.toggle("disabled", isDisabled);
    });
    updateRecommendedBadge(!show);
    if (!show) {
      hiMethod = null;
      highlightHiMethod(null);
    }
  }

  function prepareHiStep() {
    highlightHiLast(hiLastClean);
    highlightHiMethod(hiMethod);
    setHiMethodsVisibility(Boolean(hiLastClean));
  }

  function updateRecommendedBadge(forceHide = false) {
    const normalizedLast = (hiLastClean || "").toLowerCase();
    const hasSelection = Boolean(hiLastClean) && !forceHide;

    if (hiBadges.bolsa) hiBadges.bolsa.classList.add("hidden");
    if (hiBadges.completa) hiBadges.completa.classList.add("hidden");

    if (!hasSelection) return;

    const recommendsBag = normalizedLast === "menos de 6 meses" || normalizedLast === "1 ano";
    if (recommendsBag) {
      hiBadges.bolsa?.classList.remove("hidden");
    } else {
      hiBadges.completa?.classList.remove("hidden");
    }
  }

  document.querySelectorAll(".card-hi-last").forEach(btn => {
    btn.addEventListener("click", () => {
      hiLastClean = btn.dataset.hi;
      hiMethod = null;
      highlightHiLast(hiLastClean);
      highlightHiMethod(null);
      setHiMethodsVisibility(Boolean(hiLastClean));
      updateRecommendedBadge();
    });
  });

  document.querySelectorAll(".method-card").forEach(card => {
    card.addEventListener("click", () => {
      if (!hiLastClean) {
        return;
      }
      hiMethod = card.dataset.method;
      highlightHiMethod(hiMethod);
      openCleaningSummary();
    });
  });


  // ======================================
  // HIGIENIZAÇÃO - RESUMO + PAGAMENTO
  // ======================================
  function openCleaningSummary() {

    document.getElementById("hi-summary-btu").textContent = hiBTU;
    document.getElementById("hi-summary-last").textContent = hiLastClean;
    document.getElementById("hi-summary-method").textContent = hiMethod;
    const hiLocation = selectedRegion ? `${selectedRegion} - ${selectedZone}` : selectedZone;
    document.getElementById("hi-summary-location").textContent = hiLocation;

    const baseCleaning = PRICES.cleaningMethods?.[hiMethod] || 200;
    const locationAddon = getLocationAddon();
    const price = baseCleaning + locationAddon;

    const pay = getPaymentText(price);
    hiPayInfo = pay;
    document.getElementById("hi-parc-n").textContent = pay.n;
    document.getElementById("hi-parc-value").textContent = pay.installmentValue;
    document.getElementById("hi-card-total").textContent =
      `Total no cartão: R$ ${pay.cardTotal}`;
    document.getElementById("hi-pix").textContent = `R$ ${pay.pixValue} no dinheiro ou pix`;

    goToScreen("screen-hi-t4");
  }


  document.getElementById("hi-go-t5")?.addEventListener("click", () => goToScreen("screen-hi-t5"));



  // ======================================
  // WHATSAPP - HIGIENIZAÇÃO
  // ======================================
  document.getElementById("hi-whatsapp")?.addEventListener("click", () => {

    const hiEstimate = hiPayInfo?.baseValue || "";

    const msg = encodeURIComponent(
`Olá! Quero agendar HIGIENIZAÇÃO:

- BTU: ${hiBTU}
- Última limpeza: ${hiLastClean}
- Tipo de limpeza: ${hiMethod}
- Localidade: ${selectedRegion} - ${selectedZone}
- Valor estimado: R$ ${hiEstimate}

Agendamento:
- Nome: ${document.getElementById("hi-name").value}
- Bairro: ${document.getElementById("hi-bairro").value}
- Dia: ${document.getElementById("hi-date").value}`
    );

    window.location.href = `https://wa.me/5521975232241?text=${msg}`;
  });




  // ======================================
  // MANUTENÇÃO - T2 (Aparelho)
  // ======================================
  document.querySelectorAll(".card-ma-device").forEach(btn => {
    btn.addEventListener("click", () => {
      maDevice = btn.dataset.device;
      goToScreen("screen-ma-t3");
    });
  });



  // ======================================
  // MANUTENÇÃO - T3 (Status)
  // ======================================
  document.querySelectorAll(".card-ma-status").forEach(btn => {
    btn.addEventListener("click", () => {
      maStatus = btn.dataset.status;
      openLocationStep({
        nextScreen: "screen-ma-t4",
        backScreen: "screen-ma-t3",
        afterSelect: openMaintenanceSummary
      });
    });
  });



  // ======================================
  // MANUTENÇÃO - RESUMO (SEM PARCELAR)
  // ======================================
  function openMaintenanceSummary() {

    document.getElementById("ma-summary-device").textContent = maDevice;
    document.getElementById("ma-summary-status").textContent = maStatus;
    document.getElementById("ma-summary-location").textContent = selectedZone;

    const visit = PRICES.maintenance.visit + PRICES.maintenance.visitAddon + getLocationAddon();

    document.getElementById("ma-visit-price").textContent =
      formatMoney(visit);

    goToScreen("screen-ma-t4");
  }

  document.getElementById("ma-go-t5")?.addEventListener("click", () => goToScreen("screen-ma-t5"));



  // ======================================
  // WHATSAPP - MANUTENÇÃO
  // ======================================
  document.getElementById("ma-whatsapp")?.addEventListener("click", () => {

    const visit = formatMoney(
      PRICES.maintenance.visit + PRICES.maintenance.visitAddon + getLocationAddon()
    );

    const msg = encodeURIComponent(
`Olá! Quero agendar MANUTENÇÃO:

- Aparelho: ${maDevice}
- Problema: ${maStatus}
- Localidade: ${selectedRegion} - ${selectedZone}
- Valor da visita: R$ ${visit}

Agendamento:
- Nome: ${document.getElementById("ma-name").value}
- Bairro: ${document.getElementById("ma-bairro").value}
- Dia: ${document.getElementById("ma-date").value}`
    );

    window.location.href = `https://wa.me/5521975232241?text=${msg}`;
  });




  // ======================================
  // OUTROS SERVIÇOS - T2
  // ======================================
  document.querySelectorAll(".card-os-type").forEach(btn => {
    btn.addEventListener("click", () => {
      osType = btn.dataset.os;
      goToScreen("screen-os-t3");
    });
  });



  // ======================================
  // OUTROS SERVIÇOS - T3
  // ======================================
  document.getElementById("os-go-t4")?.addEventListener("click", () => {

    osDesc = document.getElementById("os-description").value.trim();

    document.getElementById("os-summary-type").textContent = osType;
    document.getElementById("os-summary-desc").textContent =
      osDesc || "Nenhuma descrição informada.";

    goToScreen("screen-os-t4");
  });



  // ======================================
  // WHATSAPP - OUTROS SERVIÇOS
  // ======================================
  document.getElementById("os-whatsapp")?.addEventListener("click", () => {

    const msg = encodeURIComponent(
`Olá! Preciso de ajuda com um SERVIÇO DE REFRIGERAÇÃO:

- Equipamento: ${osType}
- Descrição: ${osDesc || "Nenhuma descrição informada."}

Pode me orientar?`
    );

    window.location.href = `https://wa.me/5521975232241?text=${msg}`;
  });

});
