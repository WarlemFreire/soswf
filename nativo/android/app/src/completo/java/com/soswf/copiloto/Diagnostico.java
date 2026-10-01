package com.soswf.copiloto;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Guarda o que o servico REALMENTE leu da tela, para parar de adivinhar.
 *
 * POR QUE ISTO EXISTE. O cartao de oferta de cada plataforma tem um layout que
 * so aparece na rua, no aparelho dele. Sem ver o texto de verdade, todo conserto
 * no leitor e chute -- e chute errado custa uma noite de trabalho. Com o texto
 * na mao, o conserto e uma linha.
 *
 * REGRAS, porque isto guarda texto de outro aplicativo:
 *
 * - DESLIGADO por padrao. So grava quando ele liga, e a tela diz o que sera
 *   guardado antes de ligar.
 * - Fica no aparelho. Nada sai sozinho daqui, como o resto do app.
 * - Guarda as ultimas poucas capturas e trunca cada uma. Nao e log: e amostra.
 * - Apagavel num toque, e desliga sozinho depois de um tempo para nao ficar
 *   gravando esquecido.
 */
public final class Diagnostico {

    private static final String ARQUIVO = "copiloto.semaforo";
    private static final String K_LIGADO = "diagLigado";
    private static final String K_ATE = "diagAte";
    private static final String K_CAPTURAS = "diagCapturas";
    private static final String K_PACOTES = "diagPacotes";

    /** Amostra, nao log. */
    private static final int MAX_CAPTURAS = 12;
    private static final int MAX_LETRAS = 2500;

    /** Desliga sozinho depois disto, mesmo que ele esqueca. */
    private static final long DURACAO_MS = 2 * 60 * 60 * 1000L;

    private Diagnostico() {}

    public static boolean ligado(Context contexto) {
        SharedPreferences p = prefs(contexto);
        if (!p.getBoolean(K_LIGADO, false)) return false;
        long ate = p.getLong(K_ATE, 0);
        if (ate > 0 && System.currentTimeMillis() > ate) {
            p.edit().putBoolean(K_LIGADO, false).apply();
            return false;
        }
        return true;
    }

    public static void ligar(Context contexto, boolean ligado) {
        prefs(contexto).edit()
                .putBoolean(K_LIGADO, ligado)
                .putLong(K_ATE, ligado ? System.currentTimeMillis() + DURACAO_MS : 0)
                .apply();
    }

    public static void limpar(Context contexto) {
        prefs(contexto).edit().putString(K_CAPTURAS, "[]").putString(K_PACOTES, "{}").apply();
    }

    /**
     * Conta um evento por pacote. SO O NOME DO APLICATIVO, nunca o texto.
     *
     * Existe porque eu passei seis versoes adivinhando o nome do pacote do
     * aplicativo da Uber. Se o nome estiver errado, o filtro do Android nao
     * entrega evento nenhum e TODOS os sintomas batem: o selo de teste
     * funciona, o parser acerta, as permissoes estao dadas, e zero ofertas.
     * Medir custa uma linha; adivinhar custou uma noite dele.
     *
     * A contagem anda so em diagnostico, que e opt-in e expira sozinho. O texto
     * da tela continua sendo guardado apenas para aplicativo de corrida -- de
     * banco nao se guarda nem uma letra.
     */
    public static void contarPacote(Context contexto, CharSequence pacote) {
        if (pacote == null || !ligado(contexto)) return;
        try {
            SharedPreferences p = prefs(contexto);
            JSONObject mapa = new JSONObject(p.getString(K_PACOTES, "{}"));
            String nome = pacote.toString();
            mapa.put(nome, mapa.optInt(nome, 0) + 1);
            p.edit().putString(K_PACOTES, mapa.toString()).apply();
        } catch (Exception erro) {
            // Diagnostico nunca pode derrubar o semaforo.
        }
    }

    public static String pacotes(Context contexto) {
        return prefs(contexto).getString(K_PACOTES, "{}");
    }

    /**
     * Guarda uma captura.
     *
     * @param pacote     de qual aplicativo veio
     * @param telaInteira texto de toda a tela
     * @param cartao     texto so do cartao da oferta, ou vazio se nao achou
     * @param leu        se os tres numeros sairam
     */
    public static void guardar(Context contexto, String pacote, String telaInteira, String cartao, boolean leu) {
        if (!ligado(contexto)) return;
        try {
            SharedPreferences p = prefs(contexto);
            JSONArray lista = new JSONArray(p.getString(K_CAPTURAS, "[]"));

            JSONObject item = new JSONObject();
            item.put("quando", System.currentTimeMillis());
            item.put("pacote", pacote == null ? "" : pacote);
            item.put("leu", leu);
            item.put("tela", cortar(telaInteira));
            item.put("cartao", cortar(cartao));

            JSONArray nova = new JSONArray();
            nova.put(item);
            for (int i = 0; i < lista.length() && nova.length() < MAX_CAPTURAS; i++) {
                nova.put(lista.get(i));
            }
            p.edit().putString(K_CAPTURAS, nova.toString()).apply();
        } catch (Exception erro) {
            // Diagnostico nunca pode derrubar o semaforo.
        }
    }

    public static String capturas(Context contexto) {
        return prefs(contexto).getString(K_CAPTURAS, "[]");
    }

    private static String cortar(String texto) {
        if (texto == null) return "";
        return texto.length() <= MAX_LETRAS ? texto : texto.substring(0, MAX_LETRAS) + "…";
    }

    private static SharedPreferences prefs(Context contexto) {
        return contexto.getSharedPreferences(ARQUIVO, Context.MODE_PRIVATE);
    }
}
