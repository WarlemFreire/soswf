#!/usr/bin/env node
// Navegador para o agente. Uso:
//   node nav.js text     <url>            texto visivel da pagina
//   node nav.js snapshot <url>            arvore de acessibilidade (estrutura + papeis)
//   node nav.js links    <url>            links da pagina (texto + href)
//   node nav.js shot     <url> <arquivo>  captura de tela (.jpg/.png)
//   node nav.js run      <script.js>      script proprio: module.exports = async ({page, context, browser}) => {...}
// Opcoes: --full  --width N  --height N  --wait MS  --timeout MS  --quality N
//         --profile NOME   guarda cookies/login entre execucoes em ~/.browser-profiles/NOME
'use strict';
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');
const fs = require('fs');

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[k] = true;
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function fail(msg) { console.error('ERRO: ' + msg); process.exit(2); }

(async () => {
  const { pos, opt } = parse(process.argv.slice(2));
  const [cmd, target, out] = pos;
  if (!cmd) fail('uso: node nav.js <text|snapshot|links|shot|run> <url|script> [arquivo] [opcoes]');
  if (cmd !== 'run' && !/^https?:\/\//i.test(target || '')) fail('informe uma URL http(s)');

  const viewport = { width: parseInt(opt.width || '1280', 10), height: parseInt(opt.height || '800', 10) };
  const timeout = parseInt(opt.timeout || '45000', 10);
  const wait = parseInt(opt.wait || '1500', 10);

  let browser = null;
  let context;
  if (opt.profile) {
    const dir = path.join(os.homedir(), '.browser-profiles', String(opt.profile).replace(/[^\w.-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    context = await chromium.launchPersistentContext(dir, { headless: true, viewport });
  } else {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport });
  }
  context.setDefaultTimeout(timeout);
  const page = context.pages()[0] || (await context.newPage());

  try {
    if (cmd === 'run') {
      const fn = require(path.resolve(target));
      await fn({ page, context, browser });
      return;
    }
    await page.goto(target, { waitUntil: 'load', timeout });
    if (wait > 0) await page.waitForTimeout(wait);

    if (cmd === 'text') {
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      console.log('TITULO: ' + (await page.title()));
      console.log('URL: ' + page.url());
      console.log('---');
      console.log(text.length > 30000 ? text.slice(0, 30000) + '\n...[cortado]' : text);
    } else if (cmd === 'snapshot') {
      console.log('TITULO: ' + (await page.title()));
      console.log('URL: ' + page.url());
      console.log('---');
      const snap = await page.locator('body').ariaSnapshot();
      console.log(snap.length > 40000 ? snap.slice(0, 40000) + '\n...[cortado]' : snap);
    } else if (cmd === 'links') {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].slice(0, 300).map(a => ({ t: (a.innerText || '').trim().slice(0, 80), h: a.href })));
      for (const l of links) console.log((l.t || '(sem texto)') + ' -> ' + l.h);
    } else if (cmd === 'shot') {
      if (!out) fail('informe o arquivo de saida');
      const isJpg = /\.jpe?g$/i.test(out);
      await page.screenshot({ path: out, fullPage: !!opt.full, ...(isJpg ? { type: 'jpeg', quality: parseInt(opt.quality || '80', 10) } : {}) });
      console.log('OK ' + out);
    } else {
      fail('comando desconhecido: ' + cmd);
    }
  } finally {
    await context.close();
    if (browser) await browser.close();
  }
})().catch(e => { console.error('ERRO: ' + String(e.message).split('\n')[0]); process.exit(1); });
