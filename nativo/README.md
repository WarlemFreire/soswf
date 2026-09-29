# Copiloto nativo (Android)

Casca nativa do Copiloto. **O app continua sendo o de `../copiloto`** — este
diretorio nao tem logica de produto nenhuma, so o necessario para empacotar
aquele app num APK.

Capacitor 7. O app vai inteiro dentro do APK, entao funciona offline por
construcao — nao aponta para `soswf.com` nem para nenhum servidor.


## Pegar o APK

Nao e preciso compilar nada na mao. O GitHub compila a cada push:

1. Aba **Actions** do repositorio -> workflow **APK**
2. Abra a execucao mais recente (a de cima)
3. Baixe o arquivo em **Artifacts** — `copiloto-AAAAMMDD-<commit>.apk`
4. No celular: instalar, liberando "instalar de fontes desconhecidas"

Para compilar sem esperar um push: Actions -> APK -> **Run workflow**.

O APK e de **debug**. Isso nao quer dizer versao pior: e o mesmo app, apenas
assinado com a chave de debug padrao do Android, que e o que permite instalar
direto sem loja. Para publicar na Play Store depois, ver "Release" no fim.


## Trazer os dados do PWA para o app

O APK e uma origem diferente do site, entao ele **comeca vazio** — o historico
que esta no navegador nao aparece nele sozinho. A passagem e manual, uma vez:

1. No PWA (navegador): Ajustes -> exportar backup (arquivo `.json`)
2. No APK: Ajustes -> importar backup -> escolher aquele arquivo

Depois disso o app nativo passa a ser o oficial. Vale exportar um backup antes
de qualquer atualizacao grande, porque desinstalar o APK apaga tudo.


## Estrutura

    nativo/
      capacitor.config.json    id (com.soswf.copiloto), nome, webDir
      package.json             scripts
      scripts/
        copiar-web.mjs         monta www/ a partir de ../copiloto
        gerar-icones-android.py  mipmaps a partir do icone do PWA
      www/                     GERADO, fora do git. Nunca editar a mao.
      android/                 projeto Android (este vai para o git)


## Comandos

    npm install          uma vez
    npm run web          monta www/ a partir de ../copiloto
    npm run sync         web + cap sync android
    npm run apk          sync + gradlew assembleDebug   (precisa do Android SDK)

O APK local sai em `android/app/build/outputs/apk/debug/app-debug.apk`.

Para regerar os icones depois de mexer no desenho do icone do PWA:

    python3 scripts/gerar-icones-android.py


## Decisoes que valem saber

**`www/` e sempre derivado.** Nunca editar nada dentro dele: a proxima
`npm run web` apaga a pasta inteira. Mexer no app e mexer em `../copiloto`.

**O service worker fica de fora do APK.** Dentro do app os arquivos ja estao
no aparelho, entao um cache-first nao adiciona offline nenhum e cria um jeito
de servir arquivo velho depois de atualizar. `copiar-web.mjs` nao copia
`sw.js`, e `app.js` nao registra service worker quando roda nativo.

**Exportar backup usa a folha de compartilhamento, nao download.** O WebView do
Android ignora `<a download>`: o toque simplesmente nao faria nada. Em
`copiloto/js/plataforma.js`, quando roda nativo, o arquivo e escrito no cache
do app e aberto no compartilhamento (Drive, WhatsApp, Arquivos). Cache de
proposito: nao exige permissao de armazenamento.

**Retrato fixo e abertura escura.** `screenOrientation="portrait"` porque o app
e de uma mao, e o tema de abertura usa o mesmo `#0b0f14` do app para nao dar
clarao branco entre o toque no icone e a primeira tela.

**Permissoes: so `VIBRATE`** (confirmar registro sem olhar) e `INTERNET`, que o
WebView do Capacitor exige para servir os proprios arquivos. Nenhuma permissao
de localizacao ainda — elas entram junto com o plugin de GPS, nao antes, para
o app nao pedir acesso que nao usa.

**Icone: o mesmo desenho do PWA.** `gerar-icones-android.py` reaproveita
`copiloto/icons/gerar-icones.py`, entao os dois nunca saem de sincronia.


## O que ainda e web, e precisa de plugin nativo

A casca nativa por si so nao liga os recursos que motivaram ir para o nativo.
Cada um destes e um passo separado:

- **GPS em background** (@capacitor/geolocation + servico em primeiro plano).
  E o que elimina o odometro manual. `copiloto/js/geo.js` hoje usa
  `navigator.geolocation`, que no WebView depende de plugin para funcionar.
- **Notificacao de sistema** (@capacitor/local-notifications). E o que permite
  a camada de avisos deterministicos: trecho fraco, esfriamento sustentado,
  janela de ouro, fadiga.
- **Manter a tela ligada** (plugin de wake lock). A API web nao existe no
  WebView.
- **Backup automatico.** Hoje o backup e 100% manual.

Ver `../copiloto/FUNCIONALIDADES.txt`, secao 14.1.


## Release (Play Store), quando chegar a hora

Precisa de uma chave de assinatura, que **nao pode ficar no repositorio**:

1. Gerar o keystore uma vez e guardar em lugar seguro (perde a chave, perde a
   capacidade de atualizar o app publicado):

       keytool -genkey -v -keystore copiloto.jks -keyalg RSA \
         -keysize 2048 -validity 10000 -alias copiloto

2. Em Settings -> Secrets and variables -> Actions do repositorio, criar
   `ANDROID_KEYSTORE_BASE64` (`base64 -w0 copiloto.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

3. Acrescentar ao workflow um job que recria o keystore a partir do secret e
   roda `./gradlew bundleRelease`.

Enquanto isso nao existir, o APK de debug instala e roda igual.
