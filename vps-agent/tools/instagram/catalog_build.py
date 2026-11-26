#!/usr/bin/env python3
"""Monta o catalogo dos salvos do Instagram a partir dos JSONL coletados.

Entradas (em --dir, padrao ~/work/ig):
  saved_links.jsonl   lista coletada por ig_collect.js
  catalog.jsonl       detalhes coletados por ig_fetch.js
  categories.json     (opcional) {codigo: {"category": "...", "tags": [...], "summary": "..."}}
  conteudo_limpo.json (opcional) {codigo: texto limpo escrito a partir do OCR/fala}
  <media-dir>/content.jsonl (opcional) texto bruto de slides (OCR) e videos (fala + texto na tela)
Saidas (na mesma pasta):
  catalog.db          SQLite com busca de texto (FTS5; acentos ignorados) e busca por trecho no texto bruto
  conteudo/<categoria>/<codigo>.md  um arquivo de texto por item
  catalogo.json       tudo junto, para paginas/consultas
  catalogo.md         indice legivel, agrupado por categoria

Uso:  python3 catalog_build.py [--dir PASTA]
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path

POST_URL = "https://www.instagram.com{href}"
DATE_RE = re.compile(r"(?:^|[-\s])([\w.]{1,30}) on [A-Z][a-z]+ \d{1,2}, \d{4}")
QUOTED_RE = re.compile(r':\s*"(.*)"\s*\.?\s*$', re.S)
TITLE_RE = re.compile(r'^(.*?) on Instagram:\s*"(.*)"\s*$', re.S)
TAIL_RE = re.compile(r"\n\s*(View all \d+|Add a comment|Log in to like|\d[\d,.]*\s+(likes?|views?)\b)", re.I)


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") or "sem-categoria"


def media_text(rec: dict) -> str:
    """Texto bruto de um item: OCR dos slides + fala + texto escrito na tela dos videos."""
    parts = []
    for sl in rec.get("slides", []):
        if sl.get("text", "").strip():
            parts.append(f"[slide {sl['file']}]\n{sl['text'].strip()}")
    for v in rec.get("videos", []):
        if v.get("text", "").strip():
            parts.append(f"[fala {v['file']}]\n{v['text'].strip()}")
        if v.get("onscreen_text", "").strip():
            parts.append(f"[texto na tela {v['file']}]\n{v['onscreen_text'].strip()}")
    return "\n\n".join(parts)


def best_caption(d: dict) -> str:
    """Legenda mais completa disponivel: texto da pagina > og:description > og:title > alt da miniatura."""
    og_desc = d.get("og_description") or ""
    m = QUOTED_RE.search(og_desc)
    from_desc = m.group(1).strip() if m else ""
    m = TITLE_RE.match(d.get("og_title") or "")
    from_title = m.group(2).strip() if m else ""
    seed = (from_desc or from_title)[:40]
    text = d.get("text") or ""
    from_text = ""
    if seed and seed in text:
        chunk = text[text.index(seed):]
        cut = TAIL_RE.search(chunk)
        from_text = (chunk[: cut.start()] if cut else chunk).strip()
    candidates = [from_text, from_desc, from_title, d.get("grid_alt") or ""]
    return max(candidates, key=len)


def author_handle(d: dict) -> str | None:
    m = DATE_RE.search(d.get("og_description") or "")
    return m.group(1) if m else None


def author_name(d: dict) -> str | None:
    m = TITLE_RE.match(d.get("og_title") or "")
    return m.group(1).strip() if m else None


def build(folder: Path, media_dir: Path | None = None) -> dict:
    links = {r["code"]: r for r in read_jsonl(folder / "saved_links.jsonl")}
    details = {r["code"]: r for r in read_jsonl(folder / "catalog.jsonl") if r.get("ok")}
    cats_file = folder / "categories.json"
    cats = json.loads(cats_file.read_text(encoding="utf-8")) if cats_file.is_file() else {}
    clean_file = folder / "conteudo_limpo.json"
    clean = json.loads(clean_file.read_text(encoding="utf-8")) if clean_file.is_file() else {}
    media_dir = media_dir or (folder.parent / "ig_ai74")
    raw = {r["code"]: media_text(r) for r in read_jsonl(media_dir / "content.jsonl")}
    raw.update({r["code"]: media_text(r) for r in read_jsonl(folder / "content.jsonl")})

    items = []
    for code, l in links.items():
        d = details.get(code, {})
        c = cats.get(code, {})
        caption = best_caption(d) if d else (l.get("alt") or "")
        items.append({
            "code": code,
            "url": POST_URL.format(href=l["href"]),
            "kind": "video" if (l.get("video") or d.get("has_video")) else ("carrossel" if l.get("carousel") else "foto"),
            "collections": l.get("collections", []),
            "author": author_handle(d) if d else None,
            "author_name": author_name(d) if d else None,
            "posted_at": d.get("posted_at"),
            "caption": caption,
            "hashtags": d.get("hashtags", []),
            "detailed": bool(d),
            "category": c.get("category"),
            "tags": c.get("tags", []),
            "summary": c.get("summary"),
            "needs_media": bool(c.get("needs_media")),
            "content": clean.get(code),
            "raw_media": raw.get(code, ""),
        })
    items.sort(key=lambda i: (i["category"] or "~sem categoria", -(len(i["caption"]))))

    # --- SQLite com busca ---
    db_path = folder / "catalog.db"
    if db_path.exists():
        db_path.unlink()
    db = sqlite3.connect(db_path)
    db.execute("""CREATE TABLE items (code TEXT PRIMARY KEY, url TEXT, kind TEXT, collections TEXT, author TEXT,
                  author_name TEXT, posted_at TEXT, caption TEXT, hashtags TEXT, detailed INTEGER,
                  category TEXT, tags TEXT, summary TEXT, needs_media INTEGER, content TEXT, raw_media TEXT)""")
    # busca por palavra, ignorando acentos e maiusculas
    db.execute("""CREATE VIRTUAL TABLE items_fts USING fts5(code UNINDEXED, caption, author, hashtags, category, tags,
                  summary, content, tokenize='unicode61 remove_diacritics 2')""")
    # busca por TRECHO no texto bruto (o OCR cola palavras e perde acentos)
    db.execute("CREATE VIRTUAL TABLE raw_fts USING fts5(code UNINDEXED, raw, tokenize='trigram case_sensitive 0')")
    for i in items:
        db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (i["code"], i["url"], i["kind"], ",".join(i["collections"]), i["author"], i["author_name"], i["posted_at"],
                    i["caption"], " ".join(i["hashtags"]), int(i["detailed"]), i["category"], ",".join(i["tags"]), i["summary"],
                    int(i["needs_media"]), i["content"], i["raw_media"]))
        db.execute("INSERT INTO items_fts VALUES (?,?,?,?,?,?,?,?)",
                   (i["code"], i["caption"], i["author"] or "", " ".join(i["hashtags"]), i["category"] or "", " ".join(i["tags"]),
                    i["summary"] or "", i["content"] or ""))
        if i["raw_media"]:
            db.execute("INSERT INTO raw_fts VALUES (?,?)", (i["code"], i["raw_media"]))
    db.commit()
    db.close()

    (folder / "catalogo.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- um arquivo de texto por item ---
    base = folder / "conteudo"
    for old in base.glob("*/*.md") if base.is_dir() else []:
        old.unlink()
    for i in items:
        d = base / slug(i["category"] or "sem-categoria")
        d.mkdir(parents=True, exist_ok=True)
        who = f"@{i['author']}" if i["author"] else (i["author_name"] or "?")
        md = [f"# {i['summary'] or i['code']}", "",
              f"- Link: {i['url']}", f"- Autor: {who}", f"- Data: {(i['posted_at'] or '')[:10] or '?'}", f"- Tipo: {i['kind']}",
              f"- Categoria: {i['category'] or '?'}", f"- Etiquetas: {', '.join(i['tags']) or '-'}",
              f"- Coleções: {', '.join(i['collections'])}", ""]
        if i["content"]:
            md += ["## Conteúdo", "", i["content"], ""]
        elif i["needs_media"]:
            md += ["> O conteúdo principal está na mídia (slides ou vídeo) e ainda não foi extraído.", ""]
        md += ["## Legenda", "", i["caption"] or "(sem legenda)", ""]
        if i["raw_media"]:
            md += ["## Texto bruto extraído (OCR dos slides, fala e texto na tela)", "", i["raw_media"], ""]
        (d / f"{i['code']}.md").write_text("\n".join(md), encoding="utf-8")

    # --- Markdown agrupado por categoria ---
    groups: dict[str, list[dict]] = defaultdict(list)
    for i in items:
        groups[i["category"] or "Sem categoria"].append(i)
    lines = [f"# Catalogo dos salvos ({len(items)} itens)\n"]
    for cat in sorted(groups, key=lambda c: (c == "Sem categoria", c)):
        lines.append(f"\n## {cat} ({len(groups[cat])})\n")
        for i in groups[cat]:
            who = f"@{i['author']}" if i["author"] else (i["author_name"] or "?")
            date = (i["posted_at"] or "")[:10]
            text = i["summary"] or " ".join(i["caption"].split())[:140]
            extra = f" _[{', '.join(i['tags'])}]_" if i["tags"] else ""
            lines.append(f"- [{who} {date}]({i['url']}) ({i['kind']}) {text}{extra}")
            if i["content"]:
                lines.append(f"  - Conteúdo: {i['content']}")
    (folder / "catalogo.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {"itens": len(items), "com_detalhes": sum(i["detailed"] for i in items),
            "categorizados": sum(1 for i in items if i["category"]), "categorias": len(groups),
            "com_conteudo_limpo": sum(1 for i in items if i["content"]), "com_texto_bruto": sum(1 for i in items if i["raw_media"]),
            "arquivos_de_texto": sum(1 for _ in base.glob("*/*.md"))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path.home() / "work" / "ig"))
    ap.add_argument("--media-dir", default=None, help="pasta com content.jsonl (padrao: ../ig_ai74)")
    args = ap.parse_args()
    print(json.dumps(build(Path(args.dir), Path(args.media_dir) if args.media_dir else None), ensure_ascii=False))


if __name__ == "__main__":
    main()
