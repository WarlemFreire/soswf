#!/usr/bin/env python3
"""Gera a pagina de leitura/busca do catalogo (HTML unico + data.json) a partir de catalogo.json.

  python3 build_site.py [--dir ~/work/ig]      escreve <dir>/site/index.html e <dir>/site/data.json
A pagina e estatica: busca (sem acento), filtro por categoria e item expansivel. Nada sai da VPS.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

HTML = r"""<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Meus salvos</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--ink:#1d1d1b;--mut:#6b6b66;--line:#e3e3de;--acc:#2f5bd8;--chip:#eceae4;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1a;--ink:#ecece8;--mut:#9a9a93;--line:#2c2c29;--acc:#8fb0ff;--chip:#2a2a27;--warn:#e0a84a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);padding:12px 16px 8px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0 0 8px;display:flex;justify-content:space-between;align-items:baseline}
h1 small{font-weight:400;color:var(--mut);font-size:13px}
input[type=search],select{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center}
.row select{flex:1;min-width:0}
label.chk{font-size:14px;color:var(--mut);display:flex;gap:6px;align-items:center}
main{padding:12px 16px 40px;max-width:760px;margin:0 auto}
.count{color:var(--mut);font-size:13px;margin:4px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.card h2{font-size:16px;margin:0 0 4px;line-height:1.3;cursor:pointer}
.meta{font-size:13px;color:var(--mut);display:flex;gap:6px;flex-wrap:wrap}
.tag{background:var(--chip);border-radius:999px;padding:1px 8px;font-size:12px;color:var(--mut)}
.warn{color:var(--warn)}
.body{display:none;margin-top:10px;border-top:1px solid var(--line);padding-top:10px}
.card.open .body{display:block}
.body h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:12px 0 4px}
.body p,.body pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font:inherit}
.body pre{font-size:13px;color:var(--mut);max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px;font-family:ui-monospace,Menlo,monospace}
a{color:var(--acc)}
button.more{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
mark{background:#ffe38a;color:#000;border-radius:3px}
</style>
</head>
<body>
<header>
  <h1>Meus salvos <small id="total"></small></h1>
  <input id="q" type="search" placeholder="Buscar: zapier, obsidian, restaurante..." autocomplete="off">
  <div class="row">
    <select id="cat"></select>
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="onlyContent"> só com conteúdo extraído</label>
    <label class="chk"><input type="checkbox" id="onlyMedia"> precisa da mídia</label>
  </div>
</header>
<main>
  <div class="count" id="count"></div>
  <div id="list"></div>
  <button class="more" id="more" style="display:none">Mostrar mais</button>
</main>
<script>
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const esc = s => (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = id => document.getElementById(id);
let ITEMS = [], shown = 60, view = [];
function hl(text, words){
  let out = esc(text);
  for(const w of words){ if(w.length<2) continue;
    const re = new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'); out = out.replace(re,'<mark>$1</mark>'); }
  return out;
}
function match(it, words){
  let score = 0;
  for(const w of words){
    if(it._s.includes(w)) score += 5;
    else if(it._c.includes(w)) score += 3;
    else if(it._r.includes(w)) score += 1;
    else return -1;
  }
  return score;
}
function render(){
  const q = norm($('q').value).trim(), words = q.split(/\s+/).filter(Boolean);
  const cat = $('cat').value, oc = $('onlyContent').checked, om = $('onlyMedia').checked;
  let res = [];
  for(const it of ITEMS){
    if(cat && it.g !== cat) continue;
    if(oc && !it.x) continue;
    if(om && !it.m) continue;
    const sc = words.length ? match(it, words) : 0;
    if(sc < 0) continue;
    res.push([sc, it]);
  }
  if(words.length) res.sort((a,b)=>b[0]-a[0]);
  view = res.map(r=>r[1]);
  $('count').textContent = view.length + (view.length===1?' item':' itens') + (q?' para "'+$('q').value+'"':'');
  const slice = view.slice(0, shown);
  $('list').innerHTML = slice.map(it => {
    const hasX = !!it.x;
    return '<div class="card" data-c="'+it.c+'">'+
      '<h2>'+hl(it.s||it.c, words)+'</h2>'+
      '<div class="meta"><span>'+esc(it.a?'@'+it.a:'?')+'</span><span>·</span><span>'+esc(it.k)+'</span>'+(it.d?'<span>·</span><span>'+esc(it.d)+'</span>':'')+
      (hasX?'<span class="tag">conteúdo extraído</span>':(it.m?'<span class="tag warn">conteúdo na mídia</span>':''))+'</div>'+
      '<div class="meta" style="margin-top:4px"><span class="tag">'+esc(it.g)+'</span>'+(it.t||[]).slice(0,4).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>'+
      '<div class="body">'+
        (hasX?'<h3>Conteúdo</h3><p>'+hl(it.x,words)+'</p>':'')+
        '<h3>Legenda</h3><p>'+hl(it.p||'(sem legenda)',words)+'</p>'+
        (it.r?'<h3>Texto bruto (OCR e fala)</h3><pre>'+hl(it.r,words)+'</pre>':'')+
        '<p style="margin-top:10px"><a href="'+esc(it.u)+'" target="_blank" rel="noopener">Abrir no Instagram ↗</a></p>'+
      '</div></div>';
  }).join('');
  $('more').style.display = view.length > shown ? 'block' : 'none';
  if(words.length && view.length && view.length <= 3) document.querySelectorAll('.card').forEach(c=>c.classList.add('open'));
}
$('list').addEventListener('click', e => { const h = e.target.closest('h2'); if(h) h.parentElement.classList.toggle('open'); });
$('more').onclick = () => { shown += 60; render(); };
let tm; $('q').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(()=>{ shown = 60; render(); }, 120); });
['cat','onlyContent','onlyMedia'].forEach(id => $(id).addEventListener('change', () => { shown = 60; render(); }));
fetch('data.json', {cache:'no-store'}).then(r=>r.json()).then(d => {
  ITEMS = d.items;
  for(const it of ITEMS){ it._s = norm([it.s,(it.t||[]).join(' '),it.a,it.g].join(' ')); it._c = norm([it.x,it.p].join(' ')); it._r = norm(it.r); }
  const cats = {}; ITEMS.forEach(i => cats[i.g] = (cats[i.g]||0)+1);
  $('cat').innerHTML = '<option value="">Todas as categorias ('+ITEMS.length+')</option>' +
    Object.keys(cats).sort((a,b)=>cats[b]-cats[a]).map(c => '<option value="'+esc(c)+'">'+esc(c)+' ('+cats[c]+')</option>').join('');
  $('total').textContent = ITEMS.length + ' itens · gerado em ' + d.generated;
  render();
}).catch(() => { $('count').textContent = 'Não consegui carregar os dados.'; });
</script>
</body>
</html>
"""


def build(folder: Path) -> dict:
    items = json.loads((folder / "catalogo.json").read_text(encoding="utf-8"))
    out = []
    for i in items:
        out.append({
            "c": i["code"], "u": i["url"], "k": i["kind"], "a": i.get("author") or i.get("author_name") or "",
            "d": (i.get("posted_at") or "")[:10], "g": i.get("category") or "Sem categoria",
            "t": i.get("tags") or [], "s": i.get("summary") or "", "m": bool(i.get("needs_media")),
            "x": i.get("content") or "", "p": (i.get("caption") or "")[:1500], "r": i.get("raw_media") or "",
        })
    site = folder / "site"
    site.mkdir(exist_ok=True)
    (site / "data.json").write_text(json.dumps({"generated": time.strftime("%d/%m/%Y %H:%M"), "items": out},
                                               ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (site / "index.html").write_text(HTML, encoding="utf-8")
    return {"itens": len(out), "com_conteudo": sum(1 for o in out if o["x"]),
            "data_json_kb": round((site / "data.json").stat().st_size / 1024)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path.home() / "work" / "ig"))
    args = ap.parse_args()
    print(json.dumps(build(Path(args.dir)), ensure_ascii=False))


if __name__ == "__main__":
    main()
