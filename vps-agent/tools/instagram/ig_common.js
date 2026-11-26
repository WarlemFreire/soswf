'use strict';
// Utilitarios compartilhados pelos scripts do Instagram (coleta e detalhes).
const os = require('os');
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(path.join(os.homedir(), 'tools', 'browser', 'node_modules', 'playwright'));
  }
}

const BASE = process.env.IG_BASE || 'https://www.instagram.com';
const PROFILE = path.join(os.homedir(), '.browser-profiles', 'instagram');
const OUT_DIR = process.env.IG_OUT_DIR || path.join(os.homedir(), 'work', 'ig');
const LINKS_FILE = path.join(OUT_DIR, 'saved_links.jsonl');
const CATALOG_FILE = path.join(OUT_DIR, 'catalog.jsonl');
const LOCK_FILE = path.join(OUT_DIR, '.lock');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const log = m => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) o[k] = true; else { o[k] = n; i++; }
  }
  return o;
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
}

// Um processo por vez usando o perfil (o Chromium nao abre o mesmo perfil duas vezes).
function takeLock() {
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); return false; } catch (_) { /* morto */ } }
  } catch (_) { /* sem lock */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) { /* ok */ } }

// Sinais de que o Instagram nao quer continuar: parar na hora, sem insistir.
async function blockedReason(page) {
  const url = page.url();
  if (/\/accounts\/login|\/challenge\/|\/suspended|\/accounts\/suspended/.test(url)) return 'redirecionado para ' + url;
  let text = '';
  try { text = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 1500)); } catch (_) { /* pagina trocando */ }
  if (/please wait a few minutes|try again later|temporarily blocked|we restrict certain activity|action blocked|confirm it'?s you|aguarde alguns minutos|tente novamente mais tarde/i.test(text)) {
    return 'aviso do Instagram: ' + text.replace(/\s+/g, ' ').slice(0, 160);
  }
  return null;
}

async function openContext() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(40000);
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(path.join(PROFILE, 'ig_state.json'), 'utf8')); } catch (_) { return null; }
}

module.exports = { BASE, PROFILE, OUT_DIR, LINKS_FILE, CATALOG_FILE, sleep, rand, log, parseArgs, readJsonl, writeJsonl,
  appendJsonl, takeLock, releaseLock, blockedReason, openContext, loadState };
