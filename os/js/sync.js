// sync.js — copia OS e fotos para o Supabase quando houver sinal. E o UNICO
// arquivo que conhece o servidor: trocar Supabase por Drive depois mexe so
// aqui. O app nunca espera o servidor para registrar nada.
//
// Usa a API REST do Supabase direto (sem SDK/CDN): login por e-mail e senha,
// upsert em `ordens` e upload no bucket `fotos`. Esquema em os/supabase/schema.sql.

import { db, lerConfig, gravarConfig } from "./db.js";

async function credenciais() {
  return lerConfig("supabase", { url: "", anonKey: "" });
}

export async function configurado() {
  const c = await credenciais();
  return Boolean(c.url && c.anonKey);
}

async function sessao() {
  return lerConfig("sessao", null);
}

async function chamarAuth(caminho, corpo) {
  const { url, anonKey } = await credenciais();
  const r = await fetch(`${url}/auth/v1/${caminho}`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || `Login falhou (${r.status})`);
  const s = { access: j.access_token, refresh: j.refresh_token, expira: Date.now() + j.expires_in * 1000, email: j.user?.email };
  await gravarConfig("sessao", s);
  return s;
}

export const entrar = (email, senha) => chamarAuth("token?grant_type=password", { email, password: senha });
export const sair = () => gravarConfig("sessao", null);
export async function usuario() {
  return (await sessao())?.email || null;
}

async function token() {
  let s = await sessao();
  if (!s) throw new Error("Não logado no servidor");
  if (Date.now() > s.expira - 60000) s = await chamarAuth("token?grant_type=refresh_token", { refresh_token: s.refresh });
  return s.access;
}

async function cabecalhos(extra = {}) {
  const { anonKey } = await credenciais();
  return { apikey: anonKey, Authorization: `Bearer ${await token()}`, ...extra };
}

async function enviarOS(os) {
  const { url } = await credenciais();
  const r = await fetch(`${url}/rest/v1/ordens?on_conflict=id`, {
    method: "POST",
    headers: await cabecalhos({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({ id: os.id, dados: os, atualizada_em: new Date(os.atualizadaEm).toISOString() }),
  });
  if (!r.ok) throw new Error(`OS ${os.numero}: ${r.status} ${await r.text()}`);
}

async function enviarFoto(f) {
  const { url } = await credenciais();
  const r = await fetch(`${url}/storage/v1/object/fotos/${f.osId}/${f.id}.jpg`, {
    method: "POST",
    headers: await cabecalhos({ "Content-Type": "image/jpeg", "x-upsert": "true" }),
    body: f.blob,
  });
  if (!r.ok) throw new Error(`Foto: ${r.status} ${await r.text()}`);
}

let rodando = false;

/** Envia o que mudou desde o ultimo envio. Devolve um resumo para a tela. */
export async function sincronizar() {
  if (rodando || !navigator.onLine || !(await configurado()) || !(await sessao())) {
    return { pulado: true };
  }
  rodando = true;
  let fotos = 0;
  let ordens = 0;
  try {
    for (const f of await db.todos("fotos")) {
      if (f.enviada) continue;
      await enviarFoto(f);
      await db.put("fotos", { ...f, enviada: true });
      fotos++;
    }
    for (const os of await db.todos("os")) {
      if (os.enviadaEm && os.enviadaEm >= os.atualizadaEm) continue;
      await enviarOS(os);
      // Grava so o carimbo de envio, relendo para nao pisar numa edicao feita
      // enquanto o envio estava no ar.
      const atual = await db.get("os", os.id);
      if (atual && atual.atualizadaEm === os.atualizadaEm) await db.put("os", { ...atual, enviadaEm: os.atualizadaEm });
      ordens++;
    }
    await gravarConfig("ultimaSync", { quando: Date.now(), erro: null });
    return { fotos, ordens };
  } catch (erro) {
    await gravarConfig("ultimaSync", { quando: Date.now(), erro: erro.message });
    return { erro: erro.message, fotos, ordens };
  } finally {
    rodando = false;
  }
}

/** Bytes de fotos guardadas — o plano gratuito tem limite de armazenamento. */
export async function bytesFotos() {
  let total = 0;
  for (const f of await db.todos("fotos")) total += f.blob?.size || 0;
  return total;
}

export async function pendentes() {
  const fotos = (await db.todos("fotos")).filter((f) => !f.enviada).length;
  const ordens = (await db.todos("os")).filter((o) => !o.enviadaEm || o.enviadaEm < o.atualizadaEm).length;
  return { fotos, ordens };
}
