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
3. Baixe o arquivo em **Artifacts** — `copiloto-vN-AAAAMMDD-<commit>.apk`
4. No celular: instalar, liberando "instalar de fontes desconhecidas"

Para compilar sem esperar um push: Actions -> APK -> **Run workflow**.

O `vN` do nome e o numero da execucao, e tambem o `versionCode`. Ele **sempre
sobe**: instalar um APK com numero menor que o instalado falha, e e assim que se
sabe qual e o mais novo olhando so o nome do arquivo.

O APK e de **debug**. Isso nao quer dizer versao pior: e o mesmo app, apenas
assinado para instalar direto, sem loja. Para publicar na Play Store depois, ver
"Release" no fim.


## Assinatura: por que um APK nao instalava sobre o outro

O sintoma era este, na tela do celular:

> Como o pacote tem um conflito com um pacote ja existente, o app nao foi
> instalado.

O Android se recusa a atualizar um aplicativo instalado quando a **assinatura**
mudou — e com razao: assinatura igual e a unica prova de que a atualizacao veio
de quem fez a versao anterior.

O que estava errado: o Gradle assina o APK de debug com a chave de debug da
maquina que compila, e cada runner do GitHub nasce limpo e **gera uma chave
nova**. Entao cada execucao do workflow produzia um APK com assinatura
diferente. O efeito pratico, que custou uma instalacao frustrada:

- atualizar o app para uma versao mais nova nao funcionava;
- trocar entre `limpo` e `completo` tambem nao, apesar do `applicationId` ser o
  mesmo nos dois — a promessa de "trocar de sabor e atualizacao, o historico nao
  se perde" nao se cumpria.

O conserto e uma chave **estavel**, fora do repositorio (que e publico — chave
commitada deixaria qualquer um assinar um APK que o celular dele aceitaria como
atualizacao do Copiloto, num app que tem servico de acessibilidade. Nao se faz).

A chave vive num unico segredo do repositorio, em
**Settings -> Secrets and variables -> Actions -> New repository secret**:

| Segredo | Conteudo |
|---|---|
| `ANDROID_KEYSTORE` | linha 1: a senha do cofre. Linhas seguintes: o `.p12` em base64 |

Um segredo e nao tres de proposito: criar segredo no navegador do celular e a
parte chata deste conserto, e as tres informacoes cabem numa colagem. O alias e
sempre `copiloto` e esta no `build.gradle` -- alias nao e segredo.

O fluxo separa as duas partes do segredo, escreve
`nativo/android/app/chave.p12` e passa a senha como variavel de ambiente
(mascarada no log);
`app/build.gradle` monta o `signingConfig` e o aplica a **debug e release**. Sem
o segredo o build nao quebra: volta a assinar com a chave da maquina e avisa na
execucao que aquele APK nao instala sobre o anterior.

Depois de compilar, o passo **Conferir a assinatura** roda `apksigner` nos dois
APKs e compara a impressao digital do certificado com
`nativo/android/assinatura-esperada.txt`. Se o segredo estiver com conteudo
errado, o build FALHA ali, com a impressao que saiu e a esperada no log -- em vez
de entregar um APK que so vai dar conflito na hora de instalar, no celular, na
rua.

Gerar a chave (uma vez na vida -- **perder a chave e perder a capacidade de
atualizar**, e o conflito volta):

    keytool -genkeypair -v -keystore chave.p12 -storetype PKCS12 \\
      -alias copiloto -keyalg RSA -keysize 2048 -validity 10950 \\
      -storepass "$SENHA" -dname "CN=Copiloto, O=Copiloto, C=BR"

E atualizar `assinatura-esperada.txt` com a impressao da chave nova:

    keytool -list -keystore chave.p12 -storepass "$SENHA" -rfc \\
      | openssl x509 -noout -fingerprint -sha256 \\
      | sed 's/.*=//;s/://g' | tr 'A-Z' 'a-z'

### Na troca para a chave estavel, uma vez

O APK que ja esta instalado foi assinado com a chave velha, e nada faz as duas
baterem. Entao, so nessa virada:

1. no app: **Ajustes -> exportar backup** (guarda o `.json` fora do celular)
2. desinstalar o Copiloto
3. instalar o APK novo
4. **Ajustes -> importar backup**

Da proxima vez em diante e atualizacao normal, por cima, sem perder nada.


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

A chave ja existe e ja assina release tambem (ver "Assinatura" acima), entao
falta pouco:

1. Acrescentar ao workflow um passo com `./gradlew bundleRelease` e subir o
   `.aab` como artefato.
2. No Play Console, enviar o `.aab`. Vale saber que a Play assina o aplicativo
   com uma chave dela (Play App Signing) e a nossa passa a ser chave de
   **upload** — o que e bom: chave de upload se troca, chave de assinatura nao.
3. A politica de acessibilidade da Play exige declarar para que serve o
   servico. O semaforo le a tela de outro aplicativo; isso precisa estar
   escrito, e pode nao ser aceito. O sabor `limpo` existe tambem por isso.

Enquanto isso nao existir, o APK de debug instala e roda igual.
