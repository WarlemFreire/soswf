// plataforma.js — a unica parte do app que sabe se estamos na web ou dentro da
// casca nativa Android.
//
// Nada aqui importa pacote do Capacitor: o app web continua sem dependencia
// nenhuma. Quando roda dentro do APK, a ponte nativa ja deixou `Capacitor` no
// globalThis antes dos nossos scripts, e nos so usamos o que estiver la.

export function nativo() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function plugin(nome) {
  return globalThis.Capacitor?.Plugins?.[nome] ?? null;
}

/**
 * Entrega um arquivo ao usuario.
 *
 * Na web: download normal, via <a download>.
 *
 * No Android: <a download> e ignorado pelo WebView -- o toque simplesmente nao
 * faz nada, e um backup que falha calado e pior que backup nenhum. Entao o
 * arquivo e escrito no cache do app e aberto na folha de compartilhamento, de
 * onde ele vai para o Drive, o WhatsApp ou os Arquivos. Usamos o cache de
 * proposito: nao exige permissao de armazenamento.
 *
 * Devolve uma descricao do que aconteceu, para quem chamou poder avisar na
 * tela. Lanca se nao conseguiu entregar.
 */
export async function entregarArquivo(nome, conteudo, tipo) {
  if (!nativo()) {
    baixarNaWeb(nome, conteudo, tipo);
    return { via: "download", nome };
  }

  const fs = plugin("Filesystem");
  if (!fs) throw new Error("Filesystem indisponível nesta versão do app.");

  await fs.writeFile({
    path: nome,
    data: conteudo,
    directory: "CACHE",
    encoding: "utf8",
    recursive: true,
  });
  const { uri } = await fs.getUri({ path: nome, directory: "CACHE" });

  const share = plugin("Share");
  if (!share) return { via: "arquivo", nome, uri };

  try {
    await share.share({ title: nome, files: [uri] });
  } catch (erro) {
    // `files` e o caminho certo no Capacitor 7; `url` e o antigo. Se o usuario
    // fechou a folha de compartilhamento, isso tambem cai aqui -- e nao e erro:
    // o arquivo esta escrito de qualquer jeito.
    if (/cancel/i.test(erro?.message || "")) return { via: "cancelado", nome, uri };
    try {
      await share.share({ title: nome, url: uri });
    } catch {
      return { via: "arquivo", nome, uri };
    }
  }
  return { via: "compartilhado", nome, uri };
}

function baixarNaWeb(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
