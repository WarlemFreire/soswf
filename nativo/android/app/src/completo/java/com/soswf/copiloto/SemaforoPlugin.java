package com.soswf.copiloto;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte entre o app e o servico de acessibilidade.
 *
 * O JavaScript manda os cortes medidos (que ele calcula e testa) e recebe de
 * volta cada oferta lida, para o historico. O servico nunca decide nada de
 * financeiro por conta propria: ele compara com o que veio daqui.
 *
 * Nenhum metodo aqui LIGA a acessibilidade. Isso o Android nao permite, e nem
 * deveria: quem autoriza leitura de tela e o usuario, na tela do sistema. O que
 * o plugin faz e levar ele ate la e dizer se ja esta valendo.
 */
@CapacitorPlugin(name = "Semaforo")
public class SemaforoPlugin extends Plugin {

    /**
     * Estatico porque quem tem a oferta na mao e o servico de acessibilidade,
     * que roda fora do ciclo de vida do WebView. Quando o app esta fechado isto
     * e null e a oferta simplesmente nao e avisada -- o selo apareceu do mesmo
     * jeito, que e a parte que importa no volante.
     */
    private static SemaforoPlugin instancia;

    @Override
    public void load() {
        instancia = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instancia == this) instancia = null;
        super.handleOnDestroy();
    }

    /** Chamado pelo servico a cada oferta julgada. */
    public static void avisarOferta(Oferta oferta, Oferta.Veredito veredito, String periodo, Zonas.Achado area) {
        SemaforoPlugin p = instancia;
        if (p == null || oferta == null || veredito == null) return;

        JSObject dados = new JSObject();
        dados.put("valor", oferta.valor);
        dados.put("km", oferta.km);
        dados.put("minutos", oferta.minutos);
        dados.put("reaisPorKm", oferta.reaisPorKm());
        dados.put("reaisPorHora", oferta.reaisPorHora());
        dados.put("veredito", veredito.name().toLowerCase(java.util.Locale.ROOT));
        dados.put("periodo", periodo == null ? "" : periodo);
        dados.put("quando", System.currentTimeMillis());
        dados.put("area", area == null ? "" : area.zona.nome);
        dados.put("areaNivel", area == null ? "" : area.zona.nivel);
        dados.put("areaMotivo", area == null ? "" : area.motivo);
        p.notifyListeners("oferta", dados);
    }

    /* --------------------------------------------------------------- estado */

    @PluginMethod
    public void estado(PluginCall chamada) {
        Pisos pisos = Pisos.ler(getContext());
        JSObject r = new JSObject();
        r.put("acessibilidadeAtiva", acessibilidadeAtiva(getContext()));
        // Estar na lista do Android e estar DE PE sao coisas diferentes: o
        // sistema mata servico, o fabricante poda segundo plano. Separar as
        // duas e a diferenca entre "falta autorizar" e "foi morto".
        r.put("servicoDePe", SemaforoService.emPe());
        r.put("podeSobrepor", Sobreposicao.permitido(getContext()));
        r.put("ligado", pisos.ligado);
        r.put("temPisos", pisos.temFaixaDeHora());
        r.put("amostra", pisos.amostra);
        // A versao na tela: nesta semana eu consertei o semaforo tres vezes e
        // nao havia como ele nem eu sabermos qual APK estava no aparelho.
        r.put("versao", versaoDoApp(getContext()));
        r.put("lidasHoje", Pisos.lidasHoje(getContext(), Pisos.hoje()));
        chamada.resolve(r);
    }

    /**
     * Liga ou desliga o semaforo. Isto e o interruptor do Copiloto, nao o da
     * acessibilidade: com a acessibilidade concedida e isto desligado, o
     * servico recebe os eventos e nao faz nada.
     */
    @PluginMethod
    public void ligar(PluginCall chamada) {
        Pisos.ligar(getContext(), chamada.getBoolean("ligado", false));
        chamada.resolve();
    }

    /** Recebe os cortes medidos pelo app. */
    @PluginMethod
    public void definirPisos(PluginCall chamada) {
        Pisos.gravar(
                getContext(),
                valor(chamada, "pisoHora"),
                valor(chamada, "idealHora"),
                valor(chamada, "otimoHora"),
                valor(chamada, "pisoKm"),
                valor(chamada, "custoKm"),
                chamada.getString("periodo", ""),
                chamada.getInt("amostra", 0));
        chamada.resolve();
    }

    /**
     * Recebe as areas de risco: desenho no mapa e apelidos, ja normalizados
     * pelo JavaScript. Ver Zonas.java para por que os dois convivem.
     */
    @PluginMethod
    public void definirZonas(PluginCall chamada) {
        com.getcapacitor.JSArray zonas = chamada.getArray("zonas");
        Zonas.gravar(getContext(), zonas == null ? "[]" : zonas.toString());
        chamada.resolve();
    }

    /**
     * Onde ele esta agora. O servico de acessibilidade roda em processo proprio
     * e nao tem GPS; e esta posicao que permite dizer "a corrida comeca numa
     * area marcada" sem esperar por nada no instante da oferta.
     */
    @PluginMethod
    public void definirPosicao(PluginCall chamada) {
        Double lat = chamada.getDouble("lat");
        Double lon = chamada.getDouble("lon");
        if (lat == null || lon == null || lat.isNaN() || lon.isNaN()) {
            chamada.resolve();
            return;
        }
        Zonas.gravarPosicao(getContext(), lat, lon, System.currentTimeMillis());
        chamada.resolve();
    }

    /* ---------------------------------------------------------- diagnostico */

    /**
     * Liga a captura do que o servico le.
     *
     * Existe porque o layout do cartao de oferta so aparece na rua, no aparelho
     * dele -- sem ver o texto de verdade, todo conserto no leitor e chute. Fica
     * desligado por padrao e se desliga sozinho depois de duas horas.
     */
    @PluginMethod
    public void ligarDiagnostico(PluginCall chamada) {
        Diagnostico.ligar(getContext(), chamada.getBoolean("ligado", false));
        // O filtro de pacotes do Android muda junto: sem isso, ligar o
        // diagnostico nao faria diferenca nenhuma para o caso que mais importa.
        SemaforoService.revisarFiltro();
        chamada.resolve();
    }

    @PluginMethod
    public void lerDiagnostico(PluginCall chamada) {
        JSObject r = new JSObject();
        r.put("ligado", Diagnostico.ligado(getContext()));
        try {
            r.put("capturas", new com.getcapacitor.JSArray(Diagnostico.capturas(getContext())));
        } catch (org.json.JSONException erro) {
            r.put("capturas", new com.getcapacitor.JSArray());
        }
        r.put("pacotes", Diagnostico.pacotes(getContext()));
        chamada.resolve(r);
    }

    @PluginMethod
    public void limparDiagnostico(PluginCall chamada) {
        Diagnostico.limpar(getContext());
        chamada.resolve();
    }

    /**
     * Desliga o leitor no Android, para o aplicativo de banco voltar a abrir.
     *
     * Nao e o mesmo que o interruptor "Ligado": aquele e uma flag nossa, que o
     * banco nao enxerga. Este tira o servico da lista de acessibilidade do
     * sistema -- o banco deixa de ver porque deixa de existir.
     *
     * Religar exige a tela do Android. Nao ha como um app se reconceder leitura
     * de tela, e nao deveria haver.
     */
    @PluginMethod
    public void desligarLeitor(PluginCall chamada) {
        boolean desligou = SemaforoService.desligarNoSistema();
        // Se o servico nem estava de pe, o resultado pratico e o mesmo.
        if (desligou || !SemaforoService.emPe()) Pisos.ligar(getContext(), false);

        JSObject r = new JSObject();
        r.put("desligou", desligou || !SemaforoService.emPe());
        r.put("aindaAtivo", acessibilidadeAtiva(getContext()));
        chamada.resolve(r);
    }

    /** Abre a tela do sistema onde ele concede a leitura de tela. */
    @PluginMethod
    public void abrirAjustesDeAcessibilidade(PluginCall chamada) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        chamada.resolve();
    }

    /** Abre a tela do sistema onde ele autoriza desenhar sobre outros apps. */
    @PluginMethod
    public void abrirAjustesDeSobreposicao(PluginCall chamada) {
        Intent i = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        chamada.resolve();
    }

    private static double valor(PluginCall chamada, String chave) {
        Double n = chamada.getDouble(chave);
        return n == null || n.isNaN() || n.isInfinite() ? 0 : n;
    }

    /**
     * Se o nosso servico esta na lista de servicos de acessibilidade ativos.
     *
     * Lido das Secure Settings porque nao existe API que pergunte "eu estou
     * habilitado?" -- so a lista bruta do sistema.
     */
    /**
     * Desenha um selo de mentira para o motorista ver se a sobreposicao
     * funciona, sem depender de aparecer uma oferta.
     *
     * Devolve as tres respostas separadas de proposito: com elas, "nao aparece
     * nada" deixa de ser uma frase e vira um diagnostico.
     */
    @PluginMethod
    public void testarSelo(PluginCall chamada) {
        JSObject r = new JSObject();
        r.put("servicoDePe", SemaforoService.emPe());
        r.put("podeSobrepor", Sobreposicao.permitido(getContext()));
        r.put("mostrou", SemaforoService.mostrarTeste());
        chamada.resolve(r);
    }

    static String versaoDoApp(Context contexto) {
        try {
            return contexto.getPackageManager()
                    .getPackageInfo(contexto.getPackageName(), 0).versionName;
        } catch (Exception erro) {
            return "";
        }
    }

    static boolean acessibilidadeAtiva(Context contexto) {
        String ativos = Settings.Secure.getString(
                contexto.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(ativos)) return false;

        String nosso = new ComponentName(contexto, SemaforoService.class).flattenToString();
        String nossoCurto = new ComponentName(contexto, SemaforoService.class).flattenToShortString();
        for (String parte : ativos.split(":")) {
            if (parte.equalsIgnoreCase(nosso) || parte.equalsIgnoreCase(nossoCurto)) return true;
        }
        return false;
    }
}
