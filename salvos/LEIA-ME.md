# Salvos: organizar os posts salvos do Instagram

## Passo 1: instalar a extensão (uma vez)
1. Descompacte `extensao.zip` numa pasta que você não vai apagar.
2. No Chrome, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `extensao`.
5. Fixe o ícone da extensão na barra do Chrome (ícone de quebra-cabeça → alfinete).

## Passo 2: coletar (no seu PC)
1. Abra instagram.com, já logado → seu perfil → **Salvos** → **Todas as publicações**.
2. Aperte F5 uma vez com a extensão instalada.
3. Clique no ícone da extensão → deixe **50** → **Começar a rolar**.
4. A página rola sozinha e devagar. Um aviso no canto inferior direito mostra quantos posts já foram coletados.
5. Quando parar, clique em **Baixar arquivo (salvos.json)**.

## Passo 3: processar na nuvem (grátis)
1. No Google Drive, crie a pasta **`salvos`** e envie o `salvos.json` para ela.
2. Abra https://colab.research.google.com → **Arquivo → Fazer upload de notebook** → escolha `processar_salvos.ipynb`.
3. **Ambiente de execução → Alterar o tipo de ambiente → T4 GPU**.
4. **Ambiente de execução → Executar tudo**.
5. Quando terminar, abra `catalogo.html` (ou `catalogo.csv` no Google Planilhas) na pasta `salvos` do Drive.

Faça o Passo 3 no mesmo dia da coleta: os links das imagens do Instagram expiram depois de alguns dias.

## Ainda não feito
- Mover os posts para coleções dentro do Instagram: vem depois de você aprovar as categorias.
- Reels: só lê o texto da capa, não transcreve o áudio.
- TikTok.
