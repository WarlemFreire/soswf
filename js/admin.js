ï»¿function renderAdminPanel() {

  const container = document.getElementById("admin-form");

  container.innerHTML = "";



  // Gera os blocos automaticamente

  for (const category in PRICES) {

    const group = document.createElement("div");

    group.className = "group";



    const title = document.createElement("h2");

    title.textContent = category.toUpperCase();

    group.appendChild(title);



    const items = PRICES[category];



    for (const key in items) {

      const label = document.createElement("label");

      label.textContent = key;

      group.appendChild(label);



      const input = document.createElement("input");

      input.type = "number";

      input.value = items[key];

      input.step = "10";

      input.dataset.category = category;

      input.dataset.key = key;



      group.appendChild(input);

      group.appendChild(document.createElement("br"));

    }



    container.appendChild(group);

  }

}



// Salvar

document.getElementById("save-prices").addEventListener("click", () => {

  const inputs = document.querySelectorAll("#admin-form input");



  inputs.forEach(inp => {

    const cat = inp.dataset.category;

    const key = inp.dataset.key;

    PRICES[cat][key] = Number(inp.value);

  });



  savePrices();

  alert("Pre??os atualizados com sucesso!");

});



// Restaurar padr??es

document.getElementById("restore-default").addEventListener("click", () => {

  if (confirm("Tem certeza que deseja restaurar os valores padr??o?")) {

    restoreDefaultPrices();

    renderAdminPanel();

  }

});



// Inicializa

renderAdminPanel();

