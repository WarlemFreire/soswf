#!/usr/bin/env node
// Login unico no Instagram. Roda INTERATIVO no terminal: voce digita usuario, senha (oculta)
// e, se o Instagram pedir, o codigo de verificacao. A senha NUNCA e gravada em disco nem exibida;
// so os cookies da sessao ficam no perfil ~/.browser-profiles/instagram.
//   node ig_login.js
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { Writable } = require('stream');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(path.join(os.homedir(), 'tools', 'browser', 'node_modules', 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const BASE = process.env.IG_BASE || 'https://www.instagram.com';
const PROFILE = path.join(os.homedir(), '.browser-profiles', 'instagram');

// --- entrada no terminal, com opcao de ocultar o que e digitado ---
let muted = false;
const sink = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
const rl = readline.createInterface({ input: process.stdin, output: sink, terminal: !!process.stdin.isTTY });
// fila de linhas: funciona tanto digitando no terminal quanto com entrada redirecionada
const queue = [];
let waiter = null;
rl.on('line', l => { if (waiter) { const w = waiter; waiter = null; w(l); } else queue.push(l); });
rl.on('close', () => { if (waiter) { const w = waiter; waiter = null; w(null); } });
function ask(question, hidden = false) {
  return new Promise(resolve => {
    process.stdout.write(question);
    muted = hidden;
    const done = l => { muted = false; if (hidden) process.stdout.write('\n'); resolve(l === null ? '' : l.trim()); };
    if (queue.length) done(queue.shift()); else waiter = done;
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = m => console.log(m);

async function loggedIn(context) {
  const cookies = await context.cookies(BASE);
  return cookies.some(c => c.name === 'sessionid' && c.value);
}

async function pageText(page) {
  try { return (await page.evaluate(() => document.body ? document.body.innerText : '')).replace(/\s+/g, ' ').trim(); }
  catch (_) { return ''; }
}

async function clickIfPresent(page, names) {
  for (const n of names) {
    const b = page.getByRole('button', { name: n, exact: false }).first();
    if (await b.count()) { try { await b.click({ timeout: 2000 }); return true; } catch (_) { /* segue */ } }
  }
  return false;
}

(async () => {
  say('== Login no Instagram (uma unica vez) ==');
  say('Use o seu @ de usuario (sem o arroba). A senha nao aparece na tela e nao e salva.\n');
  const user = await ask('Usuario: ');
  const pass = await ask('Senha (oculta): ', true);
  if (!user || !pass) { say('Usuario e senha sao obrigatorios.'); process.exit(2); }

  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(30000);
  const page = context.pages()[0] || (await context.newPage());
  let code = 0;

  try {
    if (await loggedIn(context)) { say('Ja existe uma sessao ativa neste perfil. Nada a fazer.'); return; }

    await page.goto(BASE + '/accounts/login/', { waitUntil: 'load' });
    await sleep(2500);
    await clickIfPresent(page, ['Decline optional cookies', 'Allow all cookies', 'Allow essential and optional cookies']);

    // Digita tecla por tecla (o botao do Instagram so habilita assim) e envia com Enter.
    // O input[type=submit] da pagina e invisivel (0x0), por isso nao e clicado.
    const userBox = page.locator('input[name="email"], input[name="username"]').first();
    const passBox = page.locator('input[name="pass"], input[name="password"]').first();
    await userBox.pressSequentially(user, { delay: 60 + Math.floor(Math.random() * 40) });
    await sleep(600);
    await passBox.pressSequentially(pass, { delay: 60 + Math.floor(Math.random() * 40) });
    await sleep(900);
    await passBox.press('Enter');
    say('Enviado. Aguardando resposta do Instagram...');

    // Segunda tentativa, uma vez so: se depois de 8 s a tela continua igual, clica no botao real.
    let retried = false;

    let codeSent = false;
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await sleep(3000);
      if (await loggedIn(context)) break;
      const url = page.url();
      const text = (await pageText(page)).slice(0, 600);

      if (!retried && Date.now() - (deadline - 150000) > 8000 && /\/accounts\/login/.test(url)
          && !/incorrect|wrong password|senha.*(incorreta|errada)|Sorry, your password/i.test(text)
          && (await page.locator('input[name="pass"], input[name="password"]').count())) {
        retried = true;
        const btn = page.locator('[role="button"], button').filter({ hasText: /^(log in|entrar)$/i }).first();
        if (await btn.count()) { try { await btn.click({ timeout: 5000 }); say('Clicando no botao Log in...'); } catch (_) { /* segue */ } }
      }

      if (/incorrect|wrong password|senha.*(incorreta|errada)|Sorry, your password/i.test(text)) {
        say('\nO Instagram diz que usuario ou senha estao incorretos. Nada mais foi tentado.'); code = 3; break;
      }
      if (/\/challenge\//.test(url) || /suspicious|unusual login|confirm it'?s you|foi voc[eê]|atividade incomum/i.test(text)) {
        say('\nO Instagram pediu uma verificacao de seguranca (' + url + ').');
        say('Abra o app do Instagram no celular, aprove a tentativa ("fui eu") e rode este script de novo.');
        say('Trecho da tela: ' + text.slice(0, 250));
        code = 4; break;
      }
      const codeInput = page.locator('input[name="verificationCode"], input[name="security_code"], input[autocomplete="one-time-code"]').first();
      if (!codeSent && (await codeInput.count())) {
        const c = await ask('\nO Instagram pediu um codigo (SMS / app autenticador). Digite: ');
        await codeInput.fill(c);
        await sleep(500);
        if (!(await clickIfPresent(page, ['Confirm', 'Confirmar', 'Continue', 'Continuar']))) await codeInput.press('Enter');
        codeSent = true;
        say('Codigo enviado. Aguardando...');
        continue;
      }
      if (/another device|outro dispositivo|check your notifications|verifique suas notifica/i.test(text)) {
        say('Aprove a entrada no app do Instagram do seu celular. Aguardando...');
      }
    }

    if (!(await loggedIn(context))) {
      if (code === 0) {
        say('\nNao consegui confirmar o login a tempo. Estado atual:');
        say('URL: ' + page.url());
        say('Tela: ' + (await pageText(page)).slice(0, 300));
        code = 5;
      }
    } else {
      await sleep(1500);
      await clickIfPresent(page, ['Not now', 'Agora n', 'Save info', 'Salvar informa']);
      fs.writeFileSync(path.join(PROFILE, 'ig_state.json'), JSON.stringify({ username: user.replace(/^@/, ''), loggedAt: new Date().toISOString() }), { mode: 0o600 });
      say('\nLOGIN OK. Sessao salva em ' + PROFILE + '. Pode fechar o terminal; o resto eu faco pelo chat.');
    }
  } catch (e) {
    say('ERRO: ' + String(e.message).split('\n')[0]);
    code = 1;
  } finally {
    await context.close();
    rl.close();
  }
  process.exit(code);
})();
