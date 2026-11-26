#!/usr/bin/env node
// Abre cada item coletado, devagar, e extrai autor, legenda, data e tipo.
//   node ig_fetch.js [--limit 20] [--min 8] [--max 20] [--only CODIGO]
//   --limit  quantos itens processar nesta execucao (padrao 20; 0 = todos os pendentes)
//   --min/--max  pausa aleatoria entre itens, em segundos (padrao 8 a 20)
// Le ~/work/ig/saved_links.jsonl e grava em ~/work/ig/catalog.jsonl (retomavel: pula o que ja foi feito).
// Para sozinho se o Instagram mostrar aviso, verificacao ou redirecionar para o login.
'use strict';
const c = require('./ig_common');

function extract() {
  const meta = n => { const e = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`); return e ? e.getAttribute('content') : null; };
  const ogTitle = meta('og:title'), ogDesc = meta('og:description');
  const h1 = document.querySelector('h1');
  const time = document.querySelector('time[datetime]');
  const header = document.querySelector('header, article header');
  const authorLink = header ? [...header.querySelectorAll('a[href^="/"]')].find(a => /^\/[\w.]+\/$/.test(a.getAttribute('href'))) : null;
  const article = document.querySelector('article, main');
  return {
    og_title: ogTitle, og_description: ogDesc, og_image: meta('og:image'),
    h1: h1 ? h1.innerText : null,
    posted_at: time ? time.getAttribute('datetime') : null,
    author_handle: authorLink ? authorLink.getAttribute('href').replace(/\//g, '') : null,
    has_video: !!document.querySelector('video'),
    text: article ? article.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 2500) : null,
    hashtags: [...new Set((document.body.innerText.match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 30),
  };
}

(async () => {
  const args = c.parseArgs(process.argv.slice(2));
  const limit = args.limit === undefined ? 20 : parseInt(args.limit, 10);
  const minS = parseInt(args.min || '8', 10), maxS = Math.max(minS, parseInt(args.max || '20', 10));
  if (!c.takeLock()) { console.log('Ja existe outro processo do Instagram rodando. Aguarde terminar.'); process.exit(6); }

  const links = c.readJsonl(c.LINKS_FILE);
  const done = new Set(c.readJsonl(c.CATALOG_FILE).filter(r => r.ok).map(r => r.code));
  let todo = links.filter(l => !done.has(l.code));
  if (args.only) todo = links.filter(l => l.code === args.only);
  if (limit) todo = todo.slice(0, limit);
  if (!todo.length) { console.log('Nada pendente.'); c.releaseLock(); return; }
  c.log(`${todo.length} itens a processar (${done.size} ja prontos de ${links.length})`);

  const { context, page } = await c.openContext();
  let exitCode = 0, ok = 0;
  try {
    for (const [i, l] of todo.entries()) {
      await page.goto(c.BASE + l.href, { waitUntil: 'load' });
      await c.sleep(c.rand(2500, 4500));
      const why = await c.blockedReason(page);
      if (why) throw Object.assign(new Error(why), { stop: true });
      const d = await page.evaluate(extract);
      const row = { code: l.code, href: l.href, kind: l.kind, collections: l.collections, grid_alt: l.alt || null,
                    fetched_at: new Date().toISOString(), ok: !!(d.og_title || d.h1 || d.text), ...d };
      c.appendJsonl(c.CATALOG_FILE, row);
      if (row.ok) ok++;
      c.log(`[${i + 1}/${todo.length}] ${l.code} ${row.ok ? 'ok' : 'SEM DADOS'} - ${(d.author_handle || '?')} - ${(d.h1 || d.og_title || '').replace(/\s+/g, ' ').slice(0, 70)}`);
      if (i < todo.length - 1) await c.sleep(c.rand(minS, maxS) * 1000);
    }
  } catch (e) {
    if (e.stop) { console.log('PARADO por seguranca: ' + e.message); exitCode = 7; }
    else { console.log('ERRO: ' + String(e.message).split('\n')[0]); exitCode = 1; }
  } finally {
    await context.close();
    c.releaseLock();
  }
  c.log(`fim desta execucao: ${ok} itens gravados`);
  process.exit(exitCode);
})();
