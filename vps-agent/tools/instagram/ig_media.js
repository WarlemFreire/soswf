#!/usr/bin/env node
// Baixa as midias (slides e videos) de cada item pela pagina de INCORPORACAO publica
// (/p/<codigo>/embed/captioned/), como visitante: NAO usa a sua conta nem o perfil logado.
//   node ig_media.js [--limit 20] [--codes A,B] [--min 6] [--max 14] [--out PASTA] [--retry-failed]
// Grava arquivos em ~/work/ig/media/<codigo>/ e um registro em ~/work/ig/media_manifest.jsonl (retomavel).
// Itens que nao abrem como visitante (conta privada, post removido) ficam marcados como embed_ok=false.
// Para sozinho se aparecer sinal de bloqueio (muitas falhas seguidas ou tela de login/aviso).
'use strict';
const path = require('path');
const fs = require('fs');
const c = require('./ig_common');
const { chromium } = (() => { try { return require('playwright'); } catch (_) { return require(path.join(require('os').homedir(), 'tools', 'browser', 'node_modules', 'playwright')); } })();

const MANIFEST = path.join(c.OUT_DIR, 'media_manifest.jsonl');
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const UA = undefined; // navegador padrao do Playwright

async function download(ctx, url, dest) {
  const r = await ctx.request.get(url, { timeout: 90000 });
  if (!r.ok()) throw new Error('HTTP ' + r.status());
  const body = await r.body();
  if (body.length > MAX_VIDEO_BYTES) throw new Error('arquivo grande demais');
  fs.writeFileSync(dest, body, { mode: 0o600 });
  return body.length;
}

(async () => {
  const args = c.parseArgs(process.argv.slice(2));
  const limit = args.limit === undefined ? 20 : parseInt(args.limit, 10);
  const minS = parseInt(args.min || '6', 10), maxS = Math.max(minS, parseInt(args.max || '14', 10));
  const outRoot = args.out ? path.resolve(args.out) : path.join(c.OUT_DIR, 'media');

  const links = c.readJsonl(c.LINKS_FILE);
  const prev = c.readJsonl(MANIFEST);
  const done = new Set(prev.filter(r => r.embed_ok || (r.embed_ok === false && !args['retry-failed'])).map(r => r.code));
  let todo = links.filter(l => !done.has(l.code));
  if (args.codes) { const set = new Set(String(args.codes).split(',')); todo = links.filter(l => set.has(l.code)); }
  if (limit) todo = todo.slice(0, limit);
  if (!todo.length) { console.log('Nada pendente.'); return; }
  c.log(`${todo.length} itens a baixar (${done.size} ja feitos)`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 700, height: 900 } });
  context.setDefaultTimeout(40000);
  const page = await context.newPage();
  let failsInRow = 0, exitCode = 0;

  try {
    for (const [i, l] of todo.entries()) {
      const dir = path.join(outRoot, l.code);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const row = { code: l.code, fetched_at: new Date().toISOString(), embed_ok: false, videos: [], images: [], error: null };
      try {
        await page.goto(`${c.BASE}/p/${l.code}/embed/captioned/`, { waitUntil: 'load' });
        await c.sleep(c.rand(3000, 4500));
        const wall = await page.evaluate(() => !!document.querySelector('input[name="username"], input[name="email"]') || /please wait a few minutes|try again later/i.test((document.body.innerText || '').slice(0, 400)));
        if (wall) { failsInRow += 3; throw new Error('tela de login/aviso na incorporacao'); }

        const seen = new Map(); // url sem query -> {tag,url,w}
        const grab = () => page.evaluate(() => [...document.querySelectorAll('img, video')]
          .map(e => ({ tag: e.tagName, url: e.currentSrc || e.src || '', w: e.naturalWidth || e.videoWidth || 0 }))
          .filter(x => x.url.startsWith('http') && /cdninstagram|fbcdn/.test(x.url) && (x.tag === 'VIDEO' || x.w >= 400)));
        for (let step = 0; step < 25; step++) {
          for (const m of await grab()) { const k = m.url.split('?')[0]; if (!seen.has(k)) seen.set(k, m); }
          const next = page.locator('button[aria-label*="Next" i], [role="button"][aria-label*="Next" i], button[aria-label*="Próx" i]').first();
          if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
          await next.click({ timeout: 3000 }).catch(() => {});
          await c.sleep(c.rand(700, 1300));
        }

        let v = 0, im = 0;
        for (const m of seen.values()) {
          if (m.tag === 'VIDEO') {
            v++; const f = `video_${v}.mp4`;
            const size = await download(context, m.url, path.join(dir, f)); row.videos.push({ file: f, bytes: size });
          } else {
            im++; const f = `slide_${String(im).padStart(2, '0')}.jpg`;
            const size = await download(context, m.url, path.join(dir, f)); row.images.push({ file: f, bytes: size, width: m.w });
          }
        }
        row.embed_ok = row.videos.length + row.images.length > 0;
        if (!row.embed_ok) row.error = 'nenhuma midia encontrada (conta privada ou post removido?)';
        failsInRow = row.embed_ok ? 0 : failsInRow + 1;
      } catch (e) {
        row.error = String(e.message).split('\n')[0];
        failsInRow++;
      }
      c.appendJsonl(MANIFEST, row);
      c.log(`[${i + 1}/${todo.length}] ${l.code} ${row.embed_ok ? 'ok' : 'FALHOU'} - ${row.videos.length} video(s), ${row.images.length} imagem(ns)${row.error ? ' - ' + row.error : ''}`);
      if (failsInRow >= 5) { console.log('PARADO por seguranca: 5 falhas seguidas'); exitCode = 7; break; }
      if (i < todo.length - 1) await c.sleep(c.rand(minS, maxS) * 1000);
    }
  } catch (e) {
    console.log('ERRO: ' + String(e.message).split('\n')[0]); exitCode = 1;
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
})();
