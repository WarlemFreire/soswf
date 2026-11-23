// app.js — telas do sistema de OS. Toda regra vem do motor; aqui so se
// desenha e se grava. Rotas por hash para funcionar offline e no APK.

import * as M from "./motor.js";
import { ROTEIROS } from "./roteiros.js";
import { db, novoId, lerConfig, gravarConfig, pedirPersistencia } from "./db.js";
import { tirarFoto } from "./camera.js";
import * as sync from "./sync.js";
import { el, limpar, toast, dataHora, moeda, mmss } from "./ui.js";

const raiz = () => document.getElementById("conteudo");
let config = M.CONFIG_PADRAO;
let relogio = null; // intervalo da contagem regressiva da tela de etapa
let travaTela = null;

const PAGAMENTOS = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito"];
const LIMITE_GRATIS = 1024 ** 3; // 1 GB de arquivos no plano gratuito do Supabase

// ---------- dados ----------

async function carregarConfig() {
  const salvo = await lerConfig("regras", {});
  config = {
    ...M.CONFIG_PADRAO,
    ...salvo,
    nitrogenio: { ...M.CONFIG_PADRAO.nitrogenio, ...salvo.nitrogenio },
    vacuo: { ...M.CONFIG_PADRAO.vacuo, ...salvo.vacuo },
    deltaT: { ...M.CONFIG_PADRAO.deltaT, ...salvo.deltaT },
  };
}

async function salvarOS(os) {
  os = { ...os, atualizadaEm: Date.now() };
  await db.put("os", os);
  agendarSync();
  return os;
}

let syncTimer = null;
function agendarSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync.sincronizar().then(atualizarSelo), 3000);
}

async function listaOS() {
  return (await db.todos("os")).sort((a, b) => b.criadaEm - a.criadaEm);
}

const urls = new Map();
async function urlFoto(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);
  const f = await db.get("fotos", id);
  if (!f) return null;
  const u = URL.createObjectURL(f.blob);
  urls.set(id, u);
  return u;
}

async function guardarFoto(osId, { blob, ts, gps }) {
  const id = novoId();
  await db.put("fotos", { id, osId, blob, ts, gps, enviada: false });
  return id;
}

const rotuloOS = (os) => `OS ${String(os.numero).padStart(4, "0")}`;
const roteiroDe = (os) => ROTEIROS[os.tipo];

// ---------- navegacao ----------

function ir(hash) {
  location.hash = hash;
}

async function rotear() {
  clearInterval(relogio);
  relogio = null;
  travaTela?.release?.().catch(() => {});
  travaTela = null;
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [rota, a, b] = partes;
  limpar(raiz());
  window.scrollTo(0, 0);
  try {
    if (!rota) await telaLista();
    else if (rota === "nova") await telaNova(a);
    else if (rota === "os" && b) await telaEtapa(a, b);
    else if (rota === "os") await telaOS(a);
    else if (rota === "relatorio") await telaRelatorio(a);
    else if (rota === "ajustes") await telaAjustes();
    else await telaLista();
  } catch (erro) {
    console.error(erro);
    raiz().append(el("p", { class: "erro" }, `Erro: ${erro.message}`));
  }
}

function cabecalho(titulo, voltar) {
  return el(
    "header",
    { class: "cabecalho" },
    voltar ? el("a", { class: "cabecalho__voltar", href: voltar, "aria-label": "Voltar" }, "‹") : null,
    el("h1", {}, titulo)
  );
}

// ---------- lista ----------

async function telaLista() {
  const lista = await listaOS();
  const abertas = lista.filter((o) => !o.concluidaEm);
  const revisar = lista.filter((o) => o.revisar && !o.revisar.feita);
  const fechadas = lista.filter((o) => o.concluidaEm).slice(0, 30);

  const cartao = (os) => {
    const r = roteiroDe(os);
    const p = M.progresso(r, os);
    return el(
      "a",
      { class: "cartao", href: `#/os/${os.id}` },
      el(
        "div",
        { class: "cartao__linha" },
        el("strong", {}, rotuloOS(os)),
        el("span", { class: "etiqueta" }, r.nome),
        os.retornoDe ? el("span", { class: "etiqueta etiqueta--alerta" }, "Retorno") : null
      ),
      el("div", {}, os.cliente?.nome || "Sem nome"),
      el(
        "div",
        { class: "cartao__linha cartao__suave" },
        `${p.feitas}/${p.total} etapas`,
        p.excecoes ? el("span", { class: "etiqueta etiqueta--alerta" }, `${p.excecoes} exceção(ões)`) : null,
        el("span", {}, dataHora(os.criadaEm))
      ),
      el("div", { class: "barra" }, el("div", { class: "barra__cheia", style: { width: `${(p.feitas / p.total) * 100}%` } }))
    );
  };

  raiz().append(
    cabecalho("Ordens de serviço"),
    el("a", { class: "botao botao--primario botao--largo", href: "#/nova" }, "+ Nova OS"),
    secao("Em andamento", abertas.map(cartao), "Nenhuma OS aberta."),
    ...(revisar.length ? [secao("A revisar", revisar.map(cartao))] : []),
    secao("Concluídas", fechadas.map(cartao), "Nenhuma ainda.")
  );
}

function secao(titulo, itens, vazio) {
  return el(
    "section",
    { class: "secao" },
    el("h2", {}, titulo),
    itens.length ? itens : el("p", { class: "suave" }, vazio)
  );
}

// ---------- nova OS ----------

async function telaNova(origemPreset) {
  const lista = await listaOS();
  const agora = Date.now();
  const origens = lista.filter((o) => !o.retornoDe && M.dentroDaGarantia(o, config, agora));
  let tipo = "instalacao";

  const campo = (rotulo, input) => el("label", { class: "campo" }, el("span", {}, rotulo), input);
  const nome = el("input", { required: true, autocomplete: "off" });
  const tel = el("input", { type: "tel", inputMode: "tel", placeholder: "21 9…" });
  const endereco = el("input", { placeholder: "Rua, número, bairro" });
  const valor = el("input", { inputMode: "decimal", placeholder: "0,00" });
  const pagamento = el("select", {}, PAGAMENTOS.map((p) => el("option", {}, p)));
  const pago = el("input", { type: "checkbox" });

  const ehRetorno = el("input", { type: "checkbox", checked: Boolean(origemPreset) });
  const origem = el(
    "select",
    {},
    el("option", { value: "" }, origens.length ? "Escolha a OS original" : "Nenhuma OS dentro da garantia"),
    origens.map((o) =>
      el("option", { value: o.id, selected: o.id === origemPreset }, `${rotuloOS(o)} · ${o.cliente?.nome} · ${dataHora(o.concluidaEm)}`)
    )
  );
  const causa = el("select", {}, el("option", { value: "" }, "Causa do retorno"), M.CAUSAS_RETORNO.map((c) => el("option", {}, c)));
  const blocoRetorno = el("div", { class: "subbloco" }, campo("OS original", origem), campo("Causa", causa));
  const mostrarRetorno = () => (blocoRetorno.hidden = !ehRetorno.checked);
  ehRetorno.addEventListener("change", mostrarRetorno);
  mostrarRetorno();

  // Retorno puxa os dados do cliente da OS original.
  origem.addEventListener("change", () => {
    const o = origens.find((x) => x.id === origem.value);
    if (o) {
      nome.value = o.cliente?.nome || "";
      tel.value = o.cliente?.telefone || "";
      endereco.value = o.cliente?.endereco || "";
    }
  });
  if (origemPreset) origem.dispatchEvent(new Event("change"));

  const tipos = el(
    "div",
    { class: "opcoes" },
    Object.values(ROTEIROS).map((r) =>
      el(
        "button",
        {
          type: "button",
          class: `opcao ${r.id === tipo ? "opcao--ativa" : ""}`,
          onclick(ev) {
            tipo = r.id;
            tipos.querySelectorAll(".opcao").forEach((b) => b.classList.remove("opcao--ativa"));
            ev.currentTarget.classList.add("opcao--ativa");
          },
        },
        r.nome
      )
    )
  );

  async function criar() {
    if (!nome.value.trim()) return toast("Informe o nome do cliente", "erro");
    if (ehRetorno.checked && (!origem.value || !causa.value)) {
      return toast("Retorno precisa da OS original e da causa", "erro");
    }
    const contador = (await lerConfig("contador", 0)) + 1;
    await gravarConfig("contador", contador);
    const os = await salvarOS({
      id: novoId(),
      numero: contador,
      tipo,
      criadaEm: Date.now(),
      cliente: { nome: nome.value.trim(), telefone: tel.value.trim(), endereco: endereco.value.trim() },
      valor: valor.value.replace(",", "."),
      pagamento: { forma: pagamento.value, pago: pago.checked },
      retornoDe: ehRetorno.checked ? origem.value : null,
      causaRetorno: ehRetorno.checked ? causa.value : null,
      etapas: {},
    });
    ir(`#/os/${os.id}`);
  }

  raiz().append(
    cabecalho("Nova OS", "#/"),
    el("h2", {}, "Serviço"),
    tipos,
    el("h2", {}, "Cliente"),
    campo("Nome", nome),
    campo("Telefone (WhatsApp)", tel),
    campo("Endereço", endereco),
    el("h2", {}, "Valor"),
    campo("Valor combinado (R$)", valor),
    campo("Forma de pagamento", pagamento),
    el("label", { class: "marcar" }, pago, el("span", {}, "Já pago")),
    el("h2", {}, "Retorno"),
    el("label", { class: "marcar" }, ehRetorno, el("span", {}, `É retorno de serviço (até ${config.garantiaDias} dias)`)),
    blocoRetorno,
    el("button", { class: "botao botao--primario botao--largo", type: "button", onclick: criar }, "Criar OS")
  );
}

// ---------- OS ----------

const ICONE = { concluida: "✓", excecao: "⚠", disponivel: "▶", bloqueada: "🔒" };

async function telaOS(id) {
  let os = await db.get("os", id);
  if (!os) return raiz().append(el("p", {}, "OS não encontrada."));
  const r = roteiroDe(os);
  const p = M.progresso(r, os);
  const origem = os.retornoDe ? await db.get("os", os.retornoDe) : null;

  const etapas = r.etapas.map((e) => {
    const st = M.situacao(r, os, e.id);
    const faltam = (e.depende || []).filter((d) => !M.etapaFeita(os, d));
    const nomeDe = (d) => r.etapas.find((x) => x.id === d).titulo;
    return el(
      st === "bloqueada" ? "div" : "a",
      { class: `etapa etapa--${st}`, href: st === "bloqueada" ? null : `#/os/${os.id}/${e.id}` },
      el("span", { class: "etapa__icone" }, ICONE[st]),
      el(
        "span",
        { class: "etapa__texto" },
        el("strong", {}, e.titulo),
        st === "bloqueada" ? el("small", {}, `Depois de: ${faltam.map(nomeDe).join(", ")}`) : null,
        st === "excecao" ? el("small", {}, "Fechada com exceção") : null
      )
    );
  });

  const pago = el("input", {
    type: "checkbox",
    checked: os.pagamento?.pago,
    async onchange() {
      os = await salvarOS({ ...os, pagamento: { ...os.pagamento, pago: pago.checked } });
    },
  });

  const acoes = [];
  if (p.completa && !os.concluidaEm) {
    acoes.push(
      el(
        "button",
        {
          class: "botao botao--primario botao--largo",
          type: "button",
          async onclick() {
            try {
              os = await salvarOS(M.finalizarOS(r, os, config));
              toast(os.revisar ? `OS finalizada · vai para revisão (${os.revisar.motivo})` : "OS finalizada", "ok");
              ir(`#/relatorio/${os.id}`);
            } catch (e) {
              toast(e.message, "erro");
            }
          },
        },
        "Finalizar OS"
      )
    );
  }
  if (os.concluidaEm) {
    acoes.push(el("a", { class: "botao botao--primario botao--largo", href: `#/relatorio/${os.id}` }, "Relatório para o cliente"));
    if (os.revisar && !os.revisar.feita) {
      acoes.push(
        el(
          "button",
          {
            class: "botao botao--largo",
            type: "button",
            async onclick() {
              await salvarOS({ ...os, revisar: { ...os.revisar, feita: true, em: Date.now() } });
              toast("Revisão registrada", "ok");
              rotear();
            },
          },
          `Marcar como revisada (${os.revisar.motivo})`
        )
      );
    }
    if (!os.retornoDe && M.dentroDaGarantia(os, config)) {
      acoes.push(el("a", { class: "botao botao--fantasma botao--largo", href: `#/nova/${os.id}` }, "Registrar retorno desta OS"));
    }
  }

  const whats = os.cliente?.telefone ? `https://wa.me/55${os.cliente.telefone.replace(/\D/g, "")}` : null;

  raiz().append(
    cabecalho(`${rotuloOS(os)} · ${r.nome}`, "#/"),
    el(
      "div",
      { class: "resumo" },
      el("div", {}, el("strong", {}, os.cliente?.nome)),
      os.cliente?.endereco ? el("div", { class: "suave" }, os.cliente.endereco) : null,
      whats ? el("a", { href: whats, target: "_blank", rel: "noopener" }, `WhatsApp ${os.cliente.telefone}`) : null,
      el("div", {}, `${moeda(os.valor)} · ${os.pagamento?.forma || "—"}`),
      el("label", { class: "marcar" }, pago, el("span", {}, "Pago")),
      origem ? el("div", { class: "aviso" }, `Retorno de ${rotuloOS(origem)} · causa: ${os.causaRetorno}`) : null
    ),
    el("div", { class: "barra" }, el("div", { class: "barra__cheia", style: { width: `${(p.feitas / p.total) * 100}%` } })),
    el("p", { class: "suave" }, `${p.feitas} de ${p.total} etapas${p.excecoes ? ` · ${p.excecoes} com exceção` : ""}`),
    el("div", { class: "etapas" }, etapas),
    ...acoes
  );
}

// ---------- etapa ----------

async function telaEtapa(osId, etapaId) {
  let os = await db.get("os", osId);
  const r = roteiroDe(os);
  const etapa = r.etapas.find((e) => e.id === etapaId);
  const st = M.situacao(r, os, etapaId);
  if (st === "bloqueada") return ir(`#/os/${osId}`);
  const fechada = st === "concluida" || st === "excecao";
  const dados = () => os.etapas?.[etapaId]?.dados || {};

  if ("wakeLock" in navigator && !fechada) {
    navigator.wakeLock.request("screen").then((t) => (travaTela = t)).catch(() => {});
  }

  async function registrar(campoId, v, extra, ts) {
    os = await salvarOS(M.registrarCampo(os, etapaId, campoId, v, extra, ts));
  }

  const contadores = []; // { campo, node } — atualizados a cada segundo

  async function widget(c) {
    const d = dados()[c.id];
    const lib = M.liberacaoCampo(c, dados(), config, Date.now());
    const bloqueado = fechada || !lib.liberado;
    const unidade = c.unidade ? ` (${c.unidade})` : "";
    const opcional = c.obrigatorio === false ? " · opcional" : "";
    const titulo = el("span", { class: "campo__rotulo" }, `${c.rotulo}${unidade}${opcional}`);
    const espera = el("span", { class: "campo__espera" });
    if (!lib.liberado && !fechada) {
      contadores.push({ campo: c, node: espera });
      if (lib.aguardando) {
        const ref = etapa.campos.find((x) => x.id === lib.aguardando);
        espera.textContent = `Libera após: ${ref.rotulo}`;
      }
    }

    let corpo;
    if (c.tipo === "foto") {
      const url = await urlFoto(d?.v);
      corpo = el(
        "div",
        { class: "foto" },
        url ? el("img", { src: url, alt: c.rotulo, class: "foto__img" }) : null,
        d?.v && !d.gps ? el("small", { class: "alerta" }, "Foto sem GPS") : null,
        fechada
          ? null
          : el(
              "button",
              {
                class: `botao ${d?.v ? "botao--fantasma" : "botao--primario"}`,
                type: "button",
                disabled: bloqueado,
                async onclick() {
                  try {
                    const f = await tirarFoto({ titulo: c.rotulo, osRotulo: rotuloOS(os) });
                    if (!f) return;
                    const fotoId = await guardarFoto(os.id, f);
                    await registrar(c.id, fotoId, { gps: f.gps }, f.ts);
                    rotear();
                  } catch (e) {
                    toast(e.message, "erro");
                  }
                },
              },
              d?.v ? "Refazer foto" : "📷 Tirar foto"
            )
      );
    } else if (c.tipo === "numero" || c.tipo === "texto") {
      const input = el(c.tipo === "texto" ? "textarea" : "input", {
        value: d?.v ?? "",
        disabled: bloqueado,
        inputMode: c.tipo === "numero" ? "decimal" : null,
        rows: c.tipo === "texto" ? 3 : null,
        async onchange() {
          const v = input.value.trim().replace(c.tipo === "numero" ? "," : "\u0000", ".");
          if (c.tipo === "numero" && v !== "" && !Number.isFinite(Number(v))) {
            return toast("Número inválido", "erro");
          }
          await registrar(c.id, c.tipo === "numero" && v !== "" ? Number(v) : v);
        },
      });
      corpo = input;
    } else if (c.tipo === "check") {
      corpo = el(
        "label",
        { class: "marcar marcar--grande" },
        el("input", {
          type: "checkbox",
          checked: Boolean(d?.v),
          disabled: bloqueado,
          onchange: (ev) => registrar(c.id, ev.target.checked),
        }),
        el("span", {}, "Confirmado")
      );
    } else if (c.tipo === "escolha") {
      corpo = el(
        "div",
        { class: "opcoes" },
        c.opcoes.map((o) =>
          el(
            "button",
            {
              type: "button",
              class: `opcao ${d?.v === o ? "opcao--ativa" : ""}`,
              disabled: bloqueado,
              async onclick() {
                await registrar(c.id, o);
                rotear();
              },
            },
            o
          )
        )
      );
    } else if (c.tipo === "assinatura") {
      corpo = d?.v ? el("img", { class: "assinatura__img", src: await urlFoto(d.v), alt: "Assinatura" }) : null;
      if (!fechada) {
        const pad = padAssinatura(async (blob) => {
          const fotoId = await guardarFoto(os.id, { blob, ts: Date.now(), gps: null });
          await registrar(c.id, fotoId);
          rotear();
        });
        corpo = el("div", {}, corpo, pad);
      }
    }
    return el("div", { class: "campo" }, titulo, espera, corpo);
  }

  const campos = [];
  for (const c of etapa.campos) campos.push(await widget(c));

  // Contagem regressiva dos campos que esperam tempo minimo.
  if (contadores.length) {
    relogio = setInterval(() => {
      const agora = Date.now();
      for (const { campo, node } of contadores) {
        const l = M.liberacaoCampo(campo, dados(), config, agora);
        if (l.liberado) {
          clearInterval(relogio);
          navigator.vibrate?.([300, 150, 300]);
          toast("Tempo mínimo cumprido: registre a leitura final", "ok");
          return rotear();
        }
        if (l.faltamMs != null) node.textContent = `Libera em ${mmss(l.faltamMs)}`;
      }
    }, 1000);
  }

  const areaFalhas = el("div");
  const est = os.etapas?.[etapaId];

  function formExcecao(falhas) {
    let fotoId = null;
    const texto = el("textarea", { rows: 3, placeholder: `Por que fechar assim? (mín. ${config.excecaoMinCaracteres} caracteres)` });
    const btnFoto = el(
      "button",
      {
        type: "button",
        class: "botao",
        async onclick() {
          try {
            const f = await tirarFoto({ titulo: "Evidência da exceção", osRotulo: rotuloOS(os) });
            if (!f) return;
            fotoId = await guardarFoto(os.id, f);
            btnFoto.textContent = "✓ Foto da exceção tirada";
          } catch (e) {
            toast(e.message, "erro");
          }
        },
      },
      "📷 Foto da evidência"
    );
    limpar(areaFalhas).append(
      el(
        "div",
        { class: "falhas" },
        el("strong", {}, "Fora do padrão:"),
        el("ul", {}, falhas.map((f) => el("li", {}, f))),
        el("p", {}, "Corrija e registre de novo, ou feche com exceção justificada (vai para revisão)."),
        texto,
        btnFoto,
        el(
          "button",
          {
            type: "button",
            class: "botao botao--perigo botao--largo",
            async onclick() {
              try {
                os = await salvarOS(M.concluirEtapa(r, os, etapaId, config, { excecao: { texto: texto.value, fotoId } }));
                toast("Etapa fechada com exceção", "alerta");
                ir(`#/os/${osId}`);
              } catch (e) {
                toast(e.exigeExcecao ? "Exceção precisa de justificativa e foto" : e.message, "erro");
              }
            },
          },
          "Fechar com exceção"
        )
      )
    );
  }

  const rodape = fechada
    ? el(
        "div",
        {},
        st === "excecao"
          ? el(
              "div",
              { class: "falhas" },
              el("strong", {}, "Fechada com exceção"),
              el("ul", {}, (est.falhas || []).map((f) => el("li", {}, f))),
              el("p", {}, `Justificativa: ${est.excecao?.texto}`)
            )
          : el("p", { class: "ok" }, `✓ Concluída em ${dataHora(est.concluidaEm)}`),
        os.concluidaEm
          ? el("p", { class: "suave" }, "OS finalizada: etapas não podem mais ser reabertas.")
          : el(
              "button",
              {
                type: "button",
                class: "botao botao--fantasma botao--largo",
                async onclick() {
                  const n = M.dependentes(r, etapaId).size;
                  if (!confirm(`Reabrir esta etapa${n ? ` e as ${n} seguintes` : ""}? Os registros ficam, mas terão de ser fechados de novo.`)) return;
                  os = await salvarOS(M.reabrirEtapa(r, os, etapaId));
                  rotear();
                },
              },
              "Reabrir etapa para corrigir"
            )
      )
    : el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--largo",
          async onclick() {
            try {
              os = await salvarOS(M.concluirEtapa(r, os, etapaId, config));
              toast("Etapa concluída", "ok");
              ir(`#/os/${osId}`);
            } catch (e) {
              if (e.exigeExcecao) formExcecao(e.falhasTecnicas);
              else {
                limpar(areaFalhas).append(el("div", { class: "falhas" }, e.message));
              }
            }
          },
        },
        "Concluir etapa"
      );

  raiz().append(
    cabecalho(etapa.titulo, `#/os/${osId}`),
    el("p", { class: "instrucao" }, etapa.instrucao),
    ...campos,
    areaFalhas,
    rodape
  );
}

function padAssinatura(aoConfirmar) {
  const canvas = el("canvas", { class: "assinatura", width: 600, height: 220 });
  const ctx = canvas.getContext("2d");
  const limparPad = () => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    riscou = false;
  };
  let desenhando = false;
  let riscou = false;
  limparPad();
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111";
  const ponto = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) * canvas.width) / r.width, ((ev.clientY - r.top) * canvas.height) / r.height];
  };
  canvas.addEventListener("pointerdown", (ev) => {
    desenhando = true;
    canvas.setPointerCapture(ev.pointerId);
    ctx.beginPath();
    ctx.moveTo(...ponto(ev));
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!desenhando) return;
    ctx.lineTo(...ponto(ev));
    ctx.stroke();
    riscou = true;
  });
  canvas.addEventListener("pointerup", () => (desenhando = false));
  return el(
    "div",
    { class: "assinatura__area" },
    canvas,
    el(
      "div",
      { class: "cartao__linha" },
      el("button", { type: "button", class: "botao botao--fantasma", onclick: limparPad }, "Limpar"),
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario",
          onclick() {
            if (!riscou) return toast("Peça ao cliente para assinar", "erro");
            canvas.toBlob(aoConfirmar, "image/png");
          },
        },
        "Confirmar assinatura"
      )
    )
  );
}

// ---------- relatorio ----------

function textoValor(c, d) {
  if (!d || d.v == null || d.v === "") return "—";
  if (c.tipo === "check") return d.v ? "Sim" : "Não";
  return `${d.v}${c.unidade ? " " + c.unidade : ""}`;
}

async function telaRelatorio(id) {
  const os = await db.get("os", id);
  const r = roteiroDe(os);
  const blocos = [];
  for (const e of r.etapas) {
    const est = os.etapas?.[e.id];
    if (!est) continue;
    const linhas = [];
    const fotos = [];
    let assinatura = null;
    for (const c of e.campos) {
      const d = est.dados?.[c.id];
      if (c.tipo === "foto") {
        const u = await urlFoto(d?.v);
        if (u) fotos.push(el("figure", {}, el("img", { src: u, alt: c.rotulo }), el("figcaption", {}, c.rotulo)));
      } else if (c.tipo === "assinatura") {
        assinatura = await urlFoto(d?.v);
      } else {
        linhas.push(el("tr", {}, el("th", {}, c.rotulo), el("td", {}, textoValor(c, d))));
      }
    }
    blocos.push(
      el(
        "section",
        { class: "rel__etapa" },
        el("h3", {}, `${est.status === "excecao" ? "⚠ " : "✓ "}${e.titulo}`),
        linhas.length ? el("table", {}, linhas) : null,
        est.status === "excecao"
          ? el("p", { class: "rel__excecao" }, `Fora do padrão: ${est.falhas.join("; ")}. Justificativa: ${est.excecao.texto}`)
          : null,
        fotos.length ? el("div", { class: "rel__fotos" }, fotos) : null,
        assinatura ? el("div", {}, el("img", { class: "rel__assinatura", src: assinatura, alt: "Assinatura" })) : null
      )
    );
  }

  const garantiaAte = os.concluidaEm ? new Date(os.concluidaEm + config.garantiaDias * 86400000) : null;
  const telefone = os.cliente?.telefone?.replace(/\D/g, "");
  const resumo =
    `SOS WF · ${rotuloOS(os)} · ${r.nome}\n` +
    `Cliente: ${os.cliente?.nome}\n` +
    `Concluído em ${dataHora(os.concluidaEm)}\n` +
    (garantiaAte ? `Garantia do serviço até ${garantiaAte.toLocaleDateString("pt-BR")}\n` : "") +
    `Segue o relatório em PDF com fotos e medições.`;

  raiz().append(
    el(
      "div",
      { class: "sem-impressao" },
      cabecalho("Relatório", `#/os/${id}`),
      el("p", { class: "suave" }, "Toque em Salvar PDF, escolha \"Salvar como PDF\" e envie o arquivo no WhatsApp do cliente."),
      el("button", { type: "button", class: "botao botao--primario botao--largo", onclick: () => print() }, "Salvar PDF"),
      telefone
        ? el(
            "a",
            {
              class: "botao botao--largo",
              href: `https://wa.me/55${telefone}?text=${encodeURIComponent(resumo)}`,
              target: "_blank",
              rel: "noopener",
            },
            "Abrir conversa no WhatsApp"
          )
        : null
    ),
    el(
      "article",
      { class: "relatorio" },
      el("h1", {}, `SOS WF · ${r.nome}`),
      el(
        "table",
        {},
        el("tr", {}, el("th", {}, "OS"), el("td", {}, rotuloOS(os))),
        el("tr", {}, el("th", {}, "Cliente"), el("td", {}, os.cliente?.nome || "—")),
        el("tr", {}, el("th", {}, "Endereço"), el("td", {}, os.cliente?.endereco || "—")),
        el("tr", {}, el("th", {}, "Abertura"), el("td", {}, dataHora(os.criadaEm))),
        el("tr", {}, el("th", {}, "Conclusão"), el("td", {}, dataHora(os.concluidaEm))),
        el("tr", {}, el("th", {}, "Valor"), el("td", {}, `${moeda(os.valor)} · ${os.pagamento?.forma || ""}`)),
        garantiaAte
          ? el("tr", {}, el("th", {}, "Garantia"), el("td", {}, `${config.garantiaDias} dias, até ${garantiaAte.toLocaleDateString("pt-BR")}`))
          : null
      ),
      blocos
    )
  );
}

// ---------- ajustes ----------

async function telaAjustes() {
  const supa = await lerConfig("supabase", { url: "", anonKey: "" });
  const usuario = await sync.usuario();
  const pend = await sync.pendentes();
  const bytes = await sync.bytesFotos();
  const ultima = await lerConfig("ultimaSync", null);
  const taxa = M.taxaRetorno(await listaOS(), config);

  const n = (rotulo, valor, salvar, unidade = "") => {
    const input = el("input", { inputMode: "decimal", value: valor });
    input.addEventListener("change", async () => {
      const v = Number(input.value.replace(",", "."));
      if (!Number.isFinite(v)) return toast("Número inválido", "erro");
      salvar(v);
      await gravarConfig("regras", config);
      toast("Salvo", "ok");
    });
    return el("label", { class: "campo" }, el("span", {}, `${rotulo}${unidade ? ` (${unidade})` : ""}`), input);
  };

  const url = el("input", { value: supa.url, placeholder: "https://xxxx.supabase.co" });
  const chave = el("input", { value: supa.anonKey, placeholder: "anon key" });
  const email = el("input", { type: "email", placeholder: "e-mail" });
  const senha = el("input", { type: "password", placeholder: "senha" });

  raiz().append(
    cabecalho("Ajustes", "#/"),

    el("h2", {}, "Retorno"),
    taxa.base
      ? el(
          "div",
          { class: "resumo" },
          el("strong", {}, `${(taxa.taxa * 100).toFixed(1)}% de retorno`),
          el("div", { class: "suave" }, `${taxa.comRetorno} de ${taxa.base} OS com garantia já vencida`),
          el("ul", {}, Object.entries(taxa.porCausa).sort((a, b) => b[1] - a[1]).map(([c, q]) => el("li", {}, `${c}: ${q}`)))
        )
      : el("p", { class: "suave" }, `A taxa aparece quando houver OS com mais de ${config.garantiaDias} dias — antes disso o número seria otimista.`),

    el("h2", {}, "Critérios"),
    n("Manômetro: 1 divisão", config.nitrogenio.resolucaoPsi, (v) => (config.nitrogenio.resolucaoPsi = v), "psi"),
    n("Nitrogênio: tempo mínimo", config.nitrogenio.minutos, (v) => (config.nitrogenio.minutos = v), "min"),
    n("Vácuo: alvo", config.vacuo.alvo, (v) => (config.vacuo.alvo = v), "mícron"),
    n("Vácuo: limite isolado", config.vacuo.limite, (v) => (config.vacuo.limite = v), "mícron"),
    n("Vácuo: tempo isolado", config.vacuo.minutos, (v) => (config.vacuo.minutos = v), "min"),
    n("Tensão: tolerância", config.tensaoTolPct, (v) => (config.tensaoTolPct = v), "%"),
    n("ΔT mínimo", config.deltaT.min, (v) => (config.deltaT.min = v), "°C"),
    n("ΔT máximo", config.deltaT.max, (v) => (config.deltaT.max = v), "°C"),
    n("Tempo ligado antes de medir", config.operacaoMinutos, (v) => (config.operacaoMinutos = v), "min"),
    n("Revisão por sorteio", config.revisaoTaxa * 100, (v) => (config.revisaoTaxa = v / 100), "%"),

    el("h2", {}, "Servidor (Supabase)"),
    el(
      "div",
      { class: "resumo" },
      el("div", {}, `Pendentes: ${pend.ordens} OS, ${pend.fotos} fotos`),
      el("div", {}, `Fotos guardadas: ${(bytes / 1024 ** 2).toFixed(1)} MB (${((bytes / LIMITE_GRATIS) * 100).toFixed(1)}% de 1 GB grátis)`),
      el("div", { class: "barra" }, el("div", { class: "barra__cheia", style: { width: `${Math.min(100, (bytes / LIMITE_GRATIS) * 100)}%` } })),
      ultima ? el("div", { class: ultima.erro ? "alerta" : "suave" }, `Último envio ${dataHora(ultima.quando)}${ultima.erro ? `: ${ultima.erro}` : " ok"}`) : null
    ),
    el("label", { class: "campo" }, el("span", {}, "URL do projeto"), url),
    el("label", { class: "campo" }, el("span", {}, "Chave anon"), chave),
    el(
      "button",
      {
        type: "button",
        class: "botao botao--largo",
        async onclick() {
          await gravarConfig("supabase", { url: url.value.trim().replace(/\/$/, ""), anonKey: chave.value.trim() });
          toast("Servidor salvo", "ok");
        },
      },
      "Salvar servidor"
    ),
    usuario
      ? el(
          "div",
          {},
          el("p", {}, `Logado como ${usuario}`),
          el("button", { type: "button", class: "botao botao--largo", onclick: async () => { const r = await sync.sincronizar(); toast(r.erro || (r.pulado ? "Sem sinal ou não configurado" : `Enviado: ${r.ordens} OS, ${r.fotos} fotos`), r.erro ? "erro" : "ok"); rotear(); } }, "Enviar agora"),
          el("button", { type: "button", class: "botao botao--fantasma botao--largo", onclick: async () => { await sync.sair(); rotear(); } }, "Sair")
        )
      : el(
          "div",
          {},
          email,
          senha,
          el(
            "button",
            {
              type: "button",
              class: "botao botao--primario botao--largo",
              async onclick() {
                try {
                  await sync.entrar(email.value.trim(), senha.value);
                  toast("Logado", "ok");
                  rotear();
                } catch (e) {
                  toast(e.message, "erro");
                }
              },
            },
            "Entrar"
          )
        )
  );
}

// ---------- selo de sincronizacao ----------

async function atualizarSelo() {
  const selo = document.getElementById("selo-sync");
  if (!selo) return;
  const p = await sync.pendentes();
  const total = p.ordens + p.fotos;
  selo.textContent = !navigator.onLine ? "Offline" : total ? `${total} a enviar` : "Em dia";
  selo.className = `selo ${!navigator.onLine || total ? "selo--alerta" : ""}`;
}

async function iniciar() {
  await carregarConfig();
  pedirPersistencia();
  addEventListener("hashchange", rotear);
  addEventListener("online", () => sync.sincronizar().then(atualizarSelo));
  addEventListener("offline", atualizarSelo);
  await rotear();
  atualizarSelo();
  sync.sincronizar().then(atualizarSelo);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

iniciar();
