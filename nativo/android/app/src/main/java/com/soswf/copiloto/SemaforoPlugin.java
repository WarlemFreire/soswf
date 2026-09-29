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
        r.put("podeSobrepor", Sobreposicao.permitido(getContext()));
        r.put("ligado", pisos.ligado);
        r.put("temPisos", pisos.temFaixaDeHora());
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
                chamada.getString("periodo", ""));
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
