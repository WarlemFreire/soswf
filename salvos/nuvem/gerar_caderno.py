"""Gera processar_salvos.ipynb (Google Colab). Rode: python3 gerar_caderno.py"""
import json, pathlib

md = lambda s: {"cell_type": "markdown", "metadata": {}, "source": s.strip()}
code = lambda s: {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip()}

C1 = r'''
# Processar salvos do Instagram (grátis, sem tokens)

1. Menu **Ambiente de execução → Alterar o tipo de ambiente → GPU T4** → Salvar.
2. No seu Google Drive, crie a pasta **`salvos`** e coloque nela o arquivo **`salvos.json`** que a extensão baixou.
3. Menu **Ambiente de execução → Executar tudo**. Na primeira célula, autorize o acesso ao Drive.

O progresso fica salvo no Drive. Se o Colab desconectar, é só **Executar tudo** de novo: ele continua de onde parou.

No fim aparecem na pasta `salvos`: **`catalogo.html`** (abra no navegador e pesquise) e **`catalogo.csv`** (abre no Google Planilhas).
'''

C2 = r'''
#@title 1. Preparar (Drive + programas)
from google.colab import drive
drive.mount('/content/drive')
PASTA = '/content/drive/MyDrive/salvos'

# Deixe vazio para a IA sugerir categorias livremente (bom para o teste de 50).
# Depois, coloque aqui a sua lista final, ex.: ['Receitas', 'Treino', 'Finanças', 'Viagem']
CATEGORIAS = []

MODELO = 'Qwen/Qwen2.5-3B-Instruct'   # cabe na GPU grátis; fala português razoavelmente
!pip -q install easyocr
'''

C3 = r'''
#@title 2. Carregar a IA e o leitor de texto das imagens
import json, os, re, io, time, requests, torch
from PIL import Image
import easyocr
from transformers import AutoTokenizer, AutoModelForCausalLM

GPU = torch.cuda.is_available()
print('GPU ligada' if GPU else 'ATENÇÃO: sem GPU. Vai ficar muito lento. Troque o tipo de ambiente para GPU T4.')
leitor = easyocr.Reader(['pt', 'en'], gpu=GPU)
tok = AutoTokenizer.from_pretrained(MODELO)
ia = AutoModelForCausalLM.from_pretrained(MODELO, torch_dtype=torch.float16 if GPU else torch.float32,
                                          device_map='auto' if GPU else None)
'''

C4 = r'''
#@title 3. Funções
NAVEGADOR = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}

def ler_imagem(url):
    """Baixa a imagem e devolve o texto escrito nela. None = link expirado/sem acesso."""
    try:
        r = requests.get(url, headers=NAVEGADOR, timeout=30)
        if r.status_code != 200:
            return None
        img = Image.open(io.BytesIO(r.content)).convert('RGB')
        img.thumbnail((1440, 1440))
        import numpy as np
        linhas = leitor.readtext(np.array(img), detail=0, paragraph=True)
        return '\n'.join(l.strip() for l in linhas if l.strip())
    except Exception as e:
        print('  erro na imagem:', e)
        return None

def perguntar_ia(post, texto_imagens):
    regra_cat = ('Escolha a categoria SOMENTE desta lista: ' + ', '.join(CATEGORIAS) + '.') if CATEGORIAS else \
                'Crie uma categoria ampla e genérica de 1 ou 2 palavras (ex.: Receitas, Treino, Finanças, Viagem, Humor).'
    conteudo = (f"Autor: @{post.get('autor','')}\n"
                f"Legenda: {post.get('legenda','')[:2500]}\n"
                f"Texto escrito nas imagens: {texto_imagens[:5000]}\n"
                f"Descrição automática das imagens: {' | '.join(post.get('alt', []))[:800]}")
    pedido = [
        {'role': 'system', 'content': 'Você cataloga posts salvos do Instagram. Responda só com JSON válido, em português.'},
        {'role': 'user', 'content': conteudo + '\n\n' + regra_cat +
         '\nResponda neste formato exato: {"categoria": "...", "subcategoria": "...", '
         '"resumo": "até 3 frases com o conteúdo útil do post", "palavras_chave": ["...", "...", "..."]}'},
    ]
    entrada = tok.apply_chat_template(pedido, add_generation_prompt=True, return_tensors='pt').to(ia.device)
    with torch.no_grad():
        saida = ia.generate(entrada, max_new_tokens=260, do_sample=False)
    texto = tok.decode(saida[0][entrada.shape[1]:], skip_special_tokens=True)
    achado = re.search(r'\{.*\}', texto, re.S)
    try:
        r = json.loads(achado.group(0))
    except Exception:
        r = {'categoria': 'Sem categoria', 'subcategoria': '', 'resumo': texto.strip()[:400], 'palavras_chave': []}
    if not isinstance(r.get('palavras_chave'), list):
        r['palavras_chave'] = [str(r.get('palavras_chave', ''))]
    return r
'''

C5 = r'''
#@title 4. Processar (continua de onde parou)
with open(f'{PASTA}/salvos.json', encoding='utf-8') as f:
    posts = json.load(f)['posts']
ARQ = f'{PASTA}/resultados.jsonl'
feitos = set()
if os.path.exists(ARQ):
    with open(ARQ, encoding='utf-8') as f:
        feitos = {json.loads(l)['code'] for l in f if l.strip()}
falta = [p for p in posts if p['code'] not in feitos]
print(f'{len(posts)} posts no arquivo, {len(feitos)} já feitos, {len(falta)} faltando.')

inicio = time.time()
for i, p in enumerate(falta, 1):
    textos, expiradas = [], 0
    for url in p.get('imagens', []):
        t = ler_imagem(url)
        if t is None: expiradas += 1
        elif t: textos.append(t)
    texto_imagens = '\n---\n'.join(textos)
    r = perguntar_ia(p, texto_imagens)
    linha = {**{k: p.get(k) for k in ('code', 'url', 'tipo', 'autor', 'legenda', 'data')},
             'texto_imagens': texto_imagens, 'imagens_expiradas': expiradas, **r}
    with open(ARQ, 'a', encoding='utf-8') as f:
        f.write(json.dumps(linha, ensure_ascii=False) + '\n')
    seg = (time.time() - inicio) / i
    print(f"[{i}/{len(falta)}] {r.get('categoria')} – @{p.get('autor')}  (~{seg:.0f}s por post, faltam ~{seg*(len(falta)-i)/60:.0f} min)")
print('Pronto.')
'''

C6 = r'''
#@title 5. Gerar catálogo (HTML pesquisável + planilha)
import csv, collections, html as H
with open(ARQ, encoding='utf-8') as f:
    res = [json.loads(l) for l in f if l.strip()]

with open(f'{PASTA}/catalogo.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['categoria', 'subcategoria', 'resumo', 'palavras_chave', 'autor', 'tipo', 'link', 'legenda', 'texto_imagens'])
    for r in res:
        w.writerow([r.get('categoria'), r.get('subcategoria'), r.get('resumo'), ', '.join(map(str, r.get('palavras_chave', []))),
                    r.get('autor'), r.get('tipo'), r.get('url'), r.get('legenda'), r.get('texto_imagens')])

PAGINA = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meus salvos</title><style>
body{font:15px system-ui,sans-serif;margin:0;background:#f6f6f6;color:#111}
header{position:sticky;top:0;background:#fff;padding:12px 16px;border-bottom:1px solid #ddd}
input,select{font-size:16px;padding:8px;border:1px solid #ccc;border-radius:6px}
input{width:100%;box-sizing:border-box;margin-bottom:8px}
main{padding:12px 16px;max-width:900px;margin:auto}
.c{background:#fff;border-radius:8px;padding:12px;margin-bottom:10px;border:1px solid #e3e3e3}
.cat{font-size:12px;color:#0a66c2;font-weight:600}.au{font-size:12px;color:#666}
details{font-size:13px;color:#444;margin-top:6px}pre{white-space:pre-wrap;font:inherit}
a{color:#0a66c2}</style></head><body>
<header><input id="q" placeholder="Pesquisar em tudo (resumo, legenda, texto das imagens)…" autofocus>
<select id="cat"><option value="">Todas as categorias</option></select> <span id="n"></span></header><main id="lista"></main>
<script>
const D = __DADOS__;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
D.forEach(d => d._t = norm([d.categoria, d.subcategoria, d.resumo, (d.palavras_chave||[]).join(' '), d.autor, d.legenda, d.texto_imagens].join(' ')));
const cats = {}; D.forEach(d => cats[d.categoria] = (cats[d.categoria]||0) + 1);
Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([c,n]) => cat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)} (${n})</option>`));
function mostrar(){
  const termos = norm(q.value).split(/\\s+/).filter(Boolean), c = cat.value;
  const r = D.filter(d => (!c || d.categoria === c) && termos.every(t => d._t.includes(t)));
  n.textContent = r.length + ' de ' + D.length;
  lista.innerHTML = r.slice(0, 300).map(d => `<div class="c"><div class="cat">${esc(d.categoria)}${d.subcategoria ? ' › ' + esc(d.subcategoria) : ''}</div>
   <div>${esc(d.resumo)}</div><div class="au">@${esc(d.autor)} · ${esc(d.tipo)} · <a href="${esc(d.url)}" target="_blank">abrir no Instagram</a></div>
   <details><summary>legenda e texto das imagens</summary><pre>${esc(d.legenda)}\\n\\n${esc(d.texto_imagens)}</pre></details></div>`).join('');
}
q.oninput = cat.onchange = mostrar; mostrar();
</script></body></html>"""
dados = json.dumps(res, ensure_ascii=False).replace('</', '<\\/')
with open(f'{PASTA}/catalogo.html', 'w', encoding='utf-8') as f:
    f.write(PAGINA.replace('__DADOS__', dados))

cont = collections.Counter(r.get('categoria') for r in res)
print('Categorias encontradas:')
for c, n in cont.most_common(): print(f'  {n:4d}  {c}')
exp = sum(1 for r in res if r.get('imagens_expiradas'))
if exp: print(f'\n{exp} posts tiveram imagens com link expirado. Rode a extensão de novo para renovar os links e reprocesse só esses.')
print(f'\nArquivos em {PASTA}: catalogo.html e catalogo.csv')
'''

nb = {
    "cells": [md(C1), code(C2), code(C3), code(C4), code(C5), code(C6)],
    "metadata": {"accelerator": "GPU", "colab": {"provenance": []},
                 "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 0,
}
destino = pathlib.Path(__file__).with_name('processar_salvos.ipynb')
destino.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding='utf-8')
print('gerado', destino)
