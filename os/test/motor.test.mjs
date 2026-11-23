// Testes do motor, dos calculos e dos roteiros. node os/test/motor.test.mjs
import assert from "node:assert/strict";
import * as C from "../js/calculos.js";
import * as M from "../js/motor.js";
import { ROTEIROS } from "../js/roteiros.js";

let passou = 0;
function teste(nome, fn) {
  try {
    fn();
    passou++;
  } catch (erro) {
    console.error(`✗ ${nome}\n  ${erro.stack}`);
    process.exitCode = 1;
  }
}

const cfg = M.CONFIG_PADRAO;
const MIN = 60000;
const T0 = Date.UTC(2026, 10, 23, 12, 0);

// ---------- calculos ----------

teste("nitrogênio: sem queda e mesma temperatura passa", () => {
  const r = C.testeNitrogenio({ pIni: 300, pFim: 300, tIni: 25, tFim: 25, minutos: 30, resolucao: 5, minutosMin: 30 });
  assert.equal(r.ok, true);
});

teste("nitrogênio: esfriou 10 °C — queda pela temperatura NÃO é vazamento", () => {
  // (314,696 × 288,15 / 298,15) − 14,696 = 289,44 psi esperados
  const r = C.testeNitrogenio({ pIni: 300, pFim: 290, tIni: 25, tFim: 15, minutos: 30, resolucao: 5, minutosMin: 30 });
  assert.ok(Math.abs(r.pEsperada - 289.44) < 0.05, `esperada ${r.pEsperada}`);
  assert.equal(r.ok, true, r.falhas.join());
});

teste("nitrogênio: esquentou — pressão igual esconde vazamento e reprova", () => {
  // Esquentou 10 °C: deveria subir ~10,5 psi. Ficou igual => perdeu gás.
  const r = C.testeNitrogenio({ pIni: 300, pFim: 300, tIni: 25, tFim: 35, minutos: 30, resolucao: 5, minutosMin: 30 });
  assert.equal(r.ok, false);
  assert.ok(r.queda > 10);
});

teste("nitrogênio: queda de 1 divisão passa, acima reprova", () => {
  const base = { pIni: 300, tIni: 25, tFim: 25, minutos: 30, resolucao: 5, minutosMin: 30 };
  assert.equal(C.testeNitrogenio({ ...base, pFim: 295 }).ok, true);
  assert.equal(C.testeNitrogenio({ ...base, pFim: 294 }).ok, false);
});

teste("nitrogênio: tempo curto reprova", () => {
  const r = C.testeNitrogenio({ pIni: 300, pFim: 300, tIni: 25, tFim: 25, minutos: 12, resolucao: 5, minutosMin: 30 });
  assert.equal(r.ok, false);
});

teste("vácuo: alvo atingido e subida dentro do limite passa", () => {
  assert.equal(C.testeVacuo({ micronAtingido: 450, micronFinal: 900, minutos: 10, alvo: 500, limite: 1000, minutosMin: 10 }).ok, true);
});

teste("vácuo: subiu além do limite reprova; não atingiu alvo reprova", () => {
  assert.equal(C.testeVacuo({ micronAtingido: 450, micronFinal: 1500, minutos: 10, alvo: 500, limite: 1000, minutosMin: 10 }).ok, false);
  assert.equal(C.testeVacuo({ micronAtingido: 700, micronFinal: 800, minutos: 10, alvo: 500, limite: 1000, minutosMin: 10 }).ok, false);
});

teste("tensão ±10%, corrente ≤ nominal, ΔT 8–14", () => {
  assert.deepEqual(C.checarTensao("218", "220", 10), []);
  assert.equal(C.checarTensao(190, 220, 10).length, 1);
  assert.deepEqual(C.checarCorrente("4,2", 5), []);
  assert.equal(C.checarCorrente(5.5, 5).length, 1);
  assert.deepEqual(C.checarDeltaT(25, 14, 8, 14).falhas, []);
  assert.equal(C.checarDeltaT(25, 20, 8, 14).falhas.length, 1);
});

// ---------- motor sobre o roteiro de instalação ----------

const R = ROTEIROS.instalacao;
const vazia = () => ({ id: "os1", tipo: "instalacao", etapas: {} });

function preencher(os, etapaId, valores, t = T0) {
  for (const [campo, v] of Object.entries(valores)) os = M.registrarCampo(os, etapaId, campo, v, {}, t);
  return os;
}

const VISTORIA = {
  foto_aparelho: "f", foto_local_evap: "f", foto_local_cond: "f", foto_etiqueta: "f",
  tensao_nominal: "220", corrente_nominal: 5, foto_quadro: "f", eletrica_ok: "Não",
};

teste("só a vistoria começa disponível", () => {
  assert.deepEqual(M.disponiveis(R, vazia()).map((e) => e.id), ["vistoria"]);
});

teste("campo faltando não fecha etapa, nem com exceção", () => {
  const os = preencher(vazia(), "vistoria", { foto_aparelho: "f" });
  assert.throws(
    () => M.concluirEtapa(R, os, "vistoria", cfg, { excecao: { texto: "justificativa longa o bastante", fotoId: "x" } }),
    /Falta registrar/
  );
});

teste("elétrica inadequada só registra e segue (decisão do dono)", () => {
  const os = M.concluirEtapa(R, preencher(vazia(), "vistoria", VISTORIA), "vistoria", cfg, { agora: T0 });
  assert.equal(os.etapas.vistoria.status, "concluida");
});

teste("fixação e furação em qualquer ordem; tubulação espera as duas", () => {
  let os = M.concluirEtapa(R, preencher(vazia(), "vistoria", VISTORIA), "vistoria", cfg, { agora: T0 });
  assert.deepEqual(M.disponiveis(R, os).map((e) => e.id).sort(), ["fixacao_evap", "furo_cond"]);
  os = M.concluirEtapa(R, preencher(os, "furo_cond", { foto_furo: "f", foto_cond: "f", coxins: true }), "furo_cond", cfg);
  assert.deepEqual(M.disponiveis(R, os).map((e) => e.id), ["fixacao_evap"]);
  assert.equal(M.situacao(R, os, "tubulacao"), "bloqueada");
});

function ateTubulacao() {
  let os = M.concluirEtapa(R, preencher(vazia(), "vistoria", VISTORIA), "vistoria", cfg, { agora: T0 });
  os = M.concluirEtapa(R, preencher(os, "fixacao_evap", { foto_placa: "f", foto_nivel: "f", caimento_dreno: true }), "fixacao_evap", cfg);
  os = M.concluirEtapa(R, preencher(os, "furo_cond", { foto_furo: "f", foto_cond: "f", coxins: true }), "furo_cond", cfg);
  os = M.concluirEtapa(R, preencher(os, "tubulacao", { comprimento: 3, foto_tubulacao: "f", flanges_ok: true }), "tubulacao", cfg);
  return os;
}

teste("nitrogênio: leitura final bloqueada antes de 30 min", () => {
  const os = preencher(ateTubulacao(), "nitrogenio", { p_ini: 300, t_ini: 25, foto_ini: "f" }, T0);
  const campo = R.etapas.find((e) => e.id === "nitrogenio").campos.find((c) => c.id === "p_fim");
  const l = M.liberacaoCampo(campo, os.etapas.nitrogenio.dados, cfg, T0 + 10 * MIN);
  assert.equal(l.liberado, false);
  assert.equal(l.faltamMs, 20 * MIN);
  assert.equal(M.liberacaoCampo(campo, os.etapas.nitrogenio.dados, cfg, T0 + 30 * MIN).liberado, true);
});

teste("nitrogênio: leitura registrada antes da hora reprova mesmo se a tela falhar", () => {
  let os = preencher(ateTubulacao(), "nitrogenio", { p_ini: 300, t_ini: 25, foto_ini: "f" }, T0);
  os = preencher(os, "nitrogenio", { p_fim: 300, t_fim: 25, foto_fim: "f" }, T0 + 5 * MIN);
  assert.throws(() => M.concluirEtapa(R, os, "nitrogenio", cfg), /antes do tempo mínimo/);
});

teste("nitrogênio com vazamento: só fecha com exceção (texto + foto) e manda para revisão", () => {
  let os = preencher(ateTubulacao(), "nitrogenio", { p_ini: 300, t_ini: 25, foto_ini: "f" }, T0);
  os = preencher(os, "nitrogenio", { p_fim: 280, t_fim: 25, foto_fim: "f" }, T0 + 31 * MIN);
  let erro;
  try { M.concluirEtapa(R, os, "nitrogenio", cfg); } catch (e) { erro = e; }
  assert.equal(erro?.exigeExcecao, true);
  assert.throws(() => M.concluirEtapa(R, os, "nitrogenio", cfg, { excecao: { texto: "curto", fotoId: "x" } }));
  assert.throws(() => M.concluirEtapa(R, os, "nitrogenio", cfg, { excecao: { texto: "texto comprido sem foto anexada" } }));
  const ok = M.concluirEtapa(R, os, "nitrogenio", cfg, { excecao: { texto: "Manômetro com defeito, refeito com outro", fotoId: "x" } });
  assert.equal(ok.etapas.nitrogenio.status, "excecao");
});

teste("reabrir o vácuo reabre tudo que veio depois e mantém os dados", () => {
  let os = preencher(ateTubulacao(), "nitrogenio", { p_ini: 300, t_ini: 25, foto_ini: "f" }, T0);
  os = preencher(os, "nitrogenio", { p_fim: 300, t_fim: 25, foto_fim: "f" }, T0 + 31 * MIN);
  os = M.concluirEtapa(R, os, "nitrogenio", cfg);
  os = preencher(os, "vacuo", { micron_atingido: 400, foto_atingido: "f" }, T0 + 40 * MIN);
  os = preencher(os, "vacuo", { micron_final: 800, foto_final: "f" }, T0 + 51 * MIN);
  os = M.concluirEtapa(R, os, "vacuo", cfg);
  os = M.concluirEtapa(R, preencher(os, "liberacao", { foto_valvulas: "f", tampas: true }), "liberacao", cfg);
  os = M.reabrirEtapa(R, os, "vacuo");
  assert.equal(M.situacao(R, os, "vacuo"), "disponivel");
  assert.equal(M.situacao(R, os, "liberacao"), "bloqueada");
  assert.equal(M.situacao(R, os, "nitrogenio"), "concluida");
  assert.equal(os.etapas.vacuo.dados.micron_final.v, 800);
});

teste("operação: compara com a etiqueta da vistoria", () => {
  const etapa = R.etapas.find((e) => e.id === "operacao");
  const os = { etapas: { vistoria: { dados: { tensao_nominal: { v: "220" }, corrente_nominal: { v: 5 } } } } };
  const falhas = etapa.avaliar({ tensao: 220, corrente: 6, t_retorno: 25, t_insuflamento: 14 }, os, cfg, {});
  assert.equal(falhas.length, 1);
  assert.match(falhas[0], /Corrente/);
});

teste("finalizar: exceção sempre vai para revisão; sem exceção depende do sorteio", () => {
  const r = { etapas: [{ id: "a", depende: [], campos: [] }] };
  const limpa = { etapas: { a: { status: "concluida" } } };
  const comExc = { etapas: { a: { status: "excecao" } } };
  assert.equal(M.finalizarOS(r, comExc, cfg, { sorteio: 0.99 }).revisar.motivo, "excecao");
  assert.equal(M.finalizarOS(r, limpa, cfg, { sorteio: 0.1 }).revisar.motivo, "sorteio");
  assert.equal(M.finalizarOS(r, limpa, cfg, { sorteio: 0.5 }).revisar, null);
  assert.throws(() => M.finalizarOS(r, { etapas: {} }, cfg));
});

teste("garantia de 90 dias e taxa de retorno só sobre OS maduras", () => {
  const dia = 86400000;
  const agora = T0 + 200 * dia;
  const lista = [
    { id: "a", concluidaEm: T0 },
    { id: "b", concluidaEm: T0 },
    { id: "c", concluidaEm: agora - 10 * dia }, // ainda na garantia: fora da base
    { id: "r1", retornoDe: "a", causaRetorno: "Dreno / pingando", concluidaEm: T0 + 20 * dia },
  ];
  assert.equal(M.dentroDaGarantia(lista[2], cfg, agora), true);
  assert.equal(M.dentroDaGarantia(lista[0], cfg, agora), false);
  const t = M.taxaRetorno(lista, cfg, agora);
  assert.equal(t.base, 2);
  assert.equal(t.taxa, 0.5);
  assert.deepEqual(t.porCausa, { "Dreno / pingando": 1 });
});

teste("todo roteiro: dependências existem, sem ciclo, termina na entrega", () => {
  for (const r of Object.values(ROTEIROS)) {
    const ids = new Set(r.etapas.map((e) => e.id));
    assert.equal(ids.size, r.etapas.length, `${r.id}: id repetido`);
    for (const e of r.etapas) {
      for (const d of e.depende || []) assert.ok(ids.has(d), `${r.id}/${e.id} depende de ${d}`);
      assert.ok(!M.dependentes(r, e.id).has(e.id), `${r.id}/${e.id} em ciclo`);
      for (const c of e.campos) {
        if (c.liberaApos) assert.ok(e.campos.some((x) => x.id === c.liberaApos.campo), `${r.id}/${e.id}/${c.id}`);
      }
    }
    assert.equal(r.etapas.at(-1).id, "entrega");
    assert.equal(M.dependentes(r, r.etapas[0].id).size, r.etapas.length - 1, `${r.id}: etapa solta`);
  }
});

console.log(`motor: ${passou} testes ok`);
