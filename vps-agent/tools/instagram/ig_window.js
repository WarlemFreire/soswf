#!/usr/bin/env node
// "Janela de login": abre o Instagram num navegador da VPS e deixa VOCE logar pelo celular.
// Serve uma paginazinha (via rota /ig-window do servidor MCP) que mostra a tela do navegador
// e repassa toques, digitacao e teclas. A senha vai direto da sua tela para o Instagram:
// nao e gravada, nem registrada em log. So os cookies da sessao ficam em ~/.browser-profiles/instagram.
// Fecha sozinho quando o login conclui ou apos 15 minutos.
//   node ig_window.js
'use strict';
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(path.join(os.homedir(), 'tools', 'browser', 'node_modules', 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const BASE = process.env.IG_BASE || 'https://www.instagram.com';
const PORT = parseInt(process.env.IG_WINDOW_PORT || '8770', 10);
const PROFILE = path.join(os.homedir(), '.browser-profiles', 'instagram');
const W = 430, H = 860;
const MAX_MS = 15 * 60 * 1000;
const KEYS = new Set(['Enter', 'Backspace', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape']);

const KEY = crypto.randomBytes(16).toString('hex');
const KEY_FILE = path.join(os.homedir(), '.browser-profiles', 'ig_window.key');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString() + ' ' + m);

const HTML = `<!doctype html><html lang="pt-br"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Janela de login</title>
<style>
 body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
 #wrap{max-width:430px;margin:0 auto}
 #st{padding:8px 10px;background:#222;font-size:13px}
 #st.ok{background:#14532d}
 img{width:100%;display:block;touch-action:manipulation;background:#000;min-height:300px}
 .bar{display:flex;gap:6px;padding:8px}
 input{flex:1;min-width:0;padding:10px;font-size:16px;border-radius:6px;border:0}
 button{padding:10px 12px;font-size:15px;border-radius:6px;border:0;background:#3b82f6;color:#fff}
 button.g{background:#444}
</style>
<div id="wrap">
 <div id="st">Conectando...</div>
 <img id="v" alt="tela do navegador">
 <div class="bar">
  <input id="t" type="password" placeholder="Toque num campo na tela e digite aqui" autocomplete="off" autocapitalize="off" autocorrect="off">
  <button id="eye" class="g" title="mostrar/ocultar">&#128065;</button>
  <button id="send">Enviar</button>
 </div>
 <div class="bar">
  <button class="g" data-k="Enter">Enter</button><button class="g" data-k="Backspace">&#9003;</button>
  <button class="g" data-k="Tab">Tab</button><button class="g" id="up">&#9650;</button><button class="g" id="down">&#9660;</button>
 </div>
</div>
<script>
const B = location.pathname.replace(/\\/?$/, '/');
const v = document.getElementById('v'), st = document.getElementById('st'), t = document.getElementById('t');
let last = null, done = false;
async function post(p, body) { try { await fetch(B + p, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body || {}) }); } catch (e) {} }
async function tick() {
  try {
    const r = await fetch(B + 'frame?' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const b = await r.blob(); const u = URL.createObjectURL(b); v.src = u; if (last) URL.revokeObjectURL(last); last = u; }
  } catch (e) {}
  if (!done) setTimeout(tick, 650);
}
async function poll() {
  try {
    const s = await (await fetch(B + 'status', { cache: 'no-store' })).json();
    if (s.logged) { st.className = 'ok'; st.textContent = 'Login concluido! Pode fechar esta pagina e voltar ao chat.'; done = true; return; }
    st.textContent = 'Toque nos campos da tela para logar. (fecha sozinho em ' + Math.max(0, Math.round(s.restantes / 60)) + ' min)';
  } catch (e) { st.textContent = 'Sem conexao com a janela (ela pode ter fechado).'; }
  setTimeout(poll, 2000);
}
v.addEventListener('click', e => { const r = v.getBoundingClientRect(); post('tap', { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); });
document.getElementById('send').onclick = () => { if (t.value) { post('type', { text: t.value }); t.value = ''; } };
document.getElementById('eye').onclick = () => { t.type = t.type === 'password' ? 'text' : 'password'; };
document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => post('key', { key: b.dataset.k }));
document.getElementById('up').onclick = () => post('scroll', { dy: -300 });
document.getElementById('down').onclick = () => post('scroll', { dy: 300 });
tick(); poll();
</script></html>`;

function readJson(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: W, height: H } });
  context.setDefaultTimeout(20000);
  const page = context.pages()[0] || (await context.newPage());
  const started = Date.now();
  let loggedAt = null;

  const isLogged = async () => (await context.cookies(BASE)).some(c => c.name === 'sessionid' && c.value);
  await page.goto(BASE + '/accounts/login/', { waitUntil: 'load' }).catch(() => {});

  let shooting = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // toda requisicao precisa da chave descartavel no caminho: /<chave>/...
    const m = url.pathname.match(/^\/([0-9a-f]{32})(\/.*)?$/);
    const okKey = m && m[1].length === KEY.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(KEY));
    url.pathname = okKey ? (m[2] || '/') : '/__negado__';
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(200, 'text/html; charset=utf-8', HTML);
      if (req.method === 'GET' && url.pathname === '/frame') {
        if (shooting) return send(204, 'text/plain', '');
        shooting = true;
        try { const img = await page.screenshot({ type: 'jpeg', quality: 55 }); return send(200, 'image/jpeg', img); }
        finally { shooting = false; }
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(200, 'application/json', JSON.stringify({ logged: !!loggedAt, restantes: Math.max(0, MAX_MS - (Date.now() - started)) / 1000 }));
      }
      if (req.method === 'POST') {
        const b = await readJson(req);
        if (url.pathname === '/tap') {
          const x = Math.min(1, Math.max(0, Number(b.x))), y = Math.min(1, Math.max(0, Number(b.y)));
          if (Number.isFinite(x) && Number.isFinite(y)) await page.mouse.click(Math.round(x * W), Math.round(y * H));
          return send(200, 'application/json', '{}');
        }
        if (url.pathname === '/type') {
          // o texto digitado NAO e registrado em log
          if (typeof b.text === 'string' && b.text.length <= 200) await page.keyboard.type(b.text, { delay: 45 });
          return send(200, 'application/json', '{}');
        }
        if (url.pathname === '/key') {
          if (KEYS.has(b.key)) await page.keyboard.press(b.key);
          return send(200, 'application/json', '{}');
        }
        if (url.pathname === '/scroll') {
          const dy = Math.max(-1000, Math.min(1000, Number(b.dy) || 0));
          await page.mouse.wheel(0, dy);
          return send(200, 'application/json', '{}');
        }
      }
      return send(404, 'text/plain', 'nao encontrado');
    } catch (e) {
      return send(500, 'text/plain', 'erro');
    }
  });
  fs.writeFileSync(KEY_FILE, KEY, { mode: 0o600 });
  server.listen(PORT, '127.0.0.1', () => log('janela aberta em 127.0.0.1:' + PORT));

  async function finish(code, why) {
    log('encerrando: ' + why);
    try { server.close(); } catch (_) { /* ok */ }
    try { fs.unlinkSync(KEY_FILE); } catch (_) { /* ok */ }
    try { await context.close(); } catch (_) { /* ok */ }
    process.exit(code);
  }

  // monitor: detecta login concluido e tenta descobrir o @ do usuario
  while (true) {
    await sleep(2000);
    if (!loggedAt && (await isLogged())) {
      loggedAt = new Date().toISOString();
      await sleep(3000);
      let username = null;
      try {
        await page.goto(BASE + '/', { waitUntil: 'load' });
        await sleep(2500);
        username = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a[href]')].find(x => x.querySelector('img[alt*="profile picture" i], img[alt*="foto do perfil" i]'));
          const m = a && a.getAttribute('href').match(/^\/([\w.]+)\/?$/);
          return m ? m[1] : null;
        });
      } catch (_) { /* sem usuario, tudo bem */ }
      fs.writeFileSync(path.join(PROFILE, 'ig_state.json'), JSON.stringify({ username, loggedAt }), { mode: 0o600 });
      log('login concluido' + (username ? ' (usuario detectado)' : ' (usuario nao detectado)'));
      await sleep(25000); // tempo para a pagina mostrar "concluido"
      return finish(0, 'login ok');
    }
    if (Date.now() - started > MAX_MS) return finish(3, 'tempo esgotado');
  }
})().catch(e => { console.error('ERRO: ' + String(e.message).split('\n')[0]); process.exit(1); });
