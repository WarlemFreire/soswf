#!/usr/bin/env node
// Coleta a LISTA dos itens salvos (links + texto alternativo da miniatura), rolando devagar.
//   node ig_collect.js [--collection all-posts] [--max 0] [--tag nome]
//   --collection  "all-posts" (padrao) ou o caminho de uma colecao, ex.: black/28581566218182147
//   --max         para depois de N itens (0 = todos)
// Grava em ~/work/ig/saved_links.jsonl (mescla; um item pode estar em varias colecoes).
// Para sozinho se o Instagram mostrar aviso, verificacao ou redirecionar para o login.
'use strict';
const c = require('./ig_common');

(async () => {
  const args = c.parseArgs(process.argv.slice(2));
  const collection = String(args.collection || 'all-posts').replace(/^\/|\/$/g, '');
  const tag = String(args.tag || collection.split('/')[0]);
  const max = parseInt(args.max || '0', 10);
  if (!c.takeLock()) { console.log('Ja existe outro processo do Instagram rodando. Aguarde terminar.'); process.exit(6); }

  const state = c.loadState();
  if (!state || !state.username) { console.log('Sem login salvo (ig_state.json). Faca o login primeiro.'); c.releaseLock(); process.exit(4); }

  const { context, page } = await c.openContext();
  const rows = new Map(c.readJsonl(c.LINKS_FILE).map(r => [r.code, r]));
  const before = rows.size;
  let exitCode = 0;

  try {
    const url = `${c.BASE}/${state.username}/saved/${collection}/`;
    c.log('abrindo ' + url);
    await page.goto(url, { waitUntil: 'load' });
    await c.sleep(c.rand(4000, 6500));
    let why = await c.blockedReason(page);
    if (why) throw Object.assign(new Error(why), { stop: true });

    const here = new Set();
    let stagnant = 0;
    for (let round = 1; round <= 300; round++) {
      const items = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
        .map(a => ({
          href: a.getAttribute('href'),
          alt: (a.querySelector('img') || {}).alt || '',
          video: !!a.querySelector('svg[aria-label*="Reel" i], svg[aria-label*="Clip" i], svg[aria-label*="Video" i], svg[aria-label*="Vídeo" i]'),
          carousel: !!a.querySelector('svg[aria-label*="Carousel" i], svg[aria-label*="Carrossel" i]'),
        }))
        .filter(x => /\/(p|reel|reels|tv)\/[\w-]+/.test(x.href)));

      let fresh = 0;
      for (const it of items) {
        const m = it.href.match(/\/(p|reel|reels|tv)\/([\w-]+)/);
        if (!m) continue;
        const code = m[2];
        if (!here.has(code)) { here.add(code); fresh++; }
        const row = rows.get(code) || { code, href: `/${m[1] === 'reels' ? 'reel' : m[1]}/${code}/`, kind: m[1], first_seen: new Date().toISOString(), collections: [] };
        row.alt = row.alt || it.alt;
        row.video = row.video || it.video;
        row.carousel = row.carousel || it.carousel;
        if (!row.collections.includes(tag)) row.collections.push(tag);
        if (row.order_in === undefined) row.order_in = {};
        if (row.order_in[tag] === undefined) row.order_in[tag] = here.size;
        rows.set(code, row);
      }
      c.log(`rodada ${round}: ${here.size} itens nesta colecao (+${fresh})`);
      if (max && here.size >= max) break;
      stagnant = fresh === 0 ? stagnant + 1 : 0;
      if (stagnant >= 4) { c.log('fim da lista'); break; }

      await page.mouse.move(c.rand(300, 900), c.rand(300, 700));
      await page.mouse.wheel(0, c.rand(600, 1100));
      await c.sleep(c.rand(3500, 7500));
      why = await c.blockedReason(page);
      if (why) throw Object.assign(new Error(why), { stop: true });
    }
    c.writeJsonl(c.LINKS_FILE, [...rows.values()]);
    c.log(`salvo: ${rows.size} itens no total (+${rows.size - before} novos) em ${c.LINKS_FILE}`);
  } catch (e) {
    c.writeJsonl(c.LINKS_FILE, [...rows.values()]); // guarda o que ja foi coletado
    if (e.stop) { console.log('PARADO por seguranca: ' + e.message); exitCode = 7; }
    else { console.log('ERRO: ' + String(e.message).split('\n')[0]); exitCode = 1; }
  } finally {
    await context.close();
    c.releaseLock();
  }
  process.exit(exitCode);
})();
