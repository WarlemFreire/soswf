package com.soswf.copiloto;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Os cortes que o semaforo usa, medidos pelo app e guardados aqui.
 *
 * Por que a conta nao mora no Java: toda a logica financeira do Copiloto e
 * testada em JavaScript (137 testes), e ela ja sabe calcular percentil por
 * faixa horaria e break-even. Duplicar isso aqui criaria duas verdades que
 * divergem na primeira correcao. Entao o JS calcula e escreve; o servico de
 * acessibilidade so compara.
 *
 * O servico de acessibilidade roda em processo proprio e continua vivo com o
 * app fechado -- por isso SharedPreferences, e nao memoria.
 */
public final class Pisos {

    private static final String ARQUIVO = "copiloto.semaforo";

    private static final String K_PISO_HORA = "pisoHora";
    private static final String K_IDEAL_HORA = "idealHora";
    private static final String K_OTIMO_HORA = "otimoHora";
    private static final String K_PISO_KM = "pisoKm";
    private static final String K_CUSTO_KM = "custoKm";
    private static final String K_LIGADO = "ligado";
    private static final String K_PERIODO = "periodo";
    private static final String K_AMOSTRA = "amostra";
    private static final String K_LIDAS_DIA = "lidasDia";
    private static final String K_LIDAS_N = "lidasN";

    public final double pisoHora;
    public final double idealHora;
    public final double otimoHora;
    public final double pisoKm;
    public final double custoKm;
    public final boolean ligado;
    public final String periodo;
    /** Quantas ofertas ja foram lidas neste periodo. Enche sozinha com o uso. */
    public final int amostra;

    private Pisos(
            double pisoHora,
            double idealHora,
            double otimoHora,
            double pisoKm,
            double custoKm,
            boolean ligado,
            String periodo,
            int amostra) {
        this.pisoHora = pisoHora;
        this.idealHora = idealHora;
        this.otimoHora = otimoHora;
        this.pisoKm = pisoKm;
        this.custoKm = custoKm;
        this.ligado = ligado;
        this.periodo = periodo;
        this.amostra = amostra;
    }

    /**
     * Sem faixa de hora nao existe veredito. Historico curto nao autoriza
     * mandar recusar corrida: melhor a sobreposicao nem aparecer.
     */
    public boolean temFaixaDeHora() {
        return pisoHora > 0 && idealHora >= pisoHora && otimoHora >= idealHora;
    }

    public static Pisos ler(Context contexto) {
        SharedPreferences p = prefs(contexto);
        return new Pisos(
                p.getFloat(K_PISO_HORA, 0f),
                p.getFloat(K_IDEAL_HORA, 0f),
                p.getFloat(K_OTIMO_HORA, 0f),
                p.getFloat(K_PISO_KM, 0f),
                p.getFloat(K_CUSTO_KM, 0f),
                p.getBoolean(K_LIGADO, false),
                p.getString(K_PERIODO, ""),
                p.getInt(K_AMOSTRA, 0));
    }

    public static void gravar(
            Context contexto,
            double pisoHora,
            double idealHora,
            double otimoHora,
            double pisoKm,
            double custoKm,
            String periodo,
            int amostra) {
        prefs(contexto)
                .edit()
                .putFloat(K_PISO_HORA, (float) pisoHora)
                .putFloat(K_IDEAL_HORA, (float) idealHora)
                .putFloat(K_OTIMO_HORA, (float) otimoHora)
                .putFloat(K_PISO_KM, (float) pisoKm)
                .putFloat(K_CUSTO_KM, (float) custoKm)
                .putString(K_PERIODO, periodo == null ? "" : periodo)
                .putInt(K_AMOSTRA, amostra)
                .apply();
    }

    /**
     * Conta uma oferta lida, aqui no servico.
     *
     * NAO da para contar isso do lado do app: ele quase sempre esta fechado
     * quando a oferta chega, e a oferta so chega ao JavaScript se o WebView
     * estiver vivo. O indicador "ofertas lidas hoje" mostrava zero mesmo
     * funcionando -- um indicador que mente e pior que nenhum.
     */
    public static void contarLida(Context contexto, String hoje) {
        SharedPreferences p = prefs(contexto);
        int n = hoje.equals(p.getString(K_LIDAS_DIA, "")) ? p.getInt(K_LIDAS_N, 0) : 0;
        p.edit().putString(K_LIDAS_DIA, hoje).putInt(K_LIDAS_N, n + 1).apply();
    }

    public static int lidasHoje(Context contexto, String hoje) {
        SharedPreferences p = prefs(contexto);
        return hoje.equals(p.getString(K_LIDAS_DIA, "")) ? p.getInt(K_LIDAS_N, 0) : 0;
    }

    /** A data no formato que contarLida espera. */
    public static String hoje() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT)
                .format(new java.util.Date());
    }

    public static void ligar(Context contexto, boolean ligado) {
        prefs(contexto).edit().putBoolean(K_LIGADO, ligado).apply();
    }

    private static SharedPreferences prefs(Context contexto) {
        return contexto.getSharedPreferences(ARQUIVO, Context.MODE_PRIVATE);
    }
}
