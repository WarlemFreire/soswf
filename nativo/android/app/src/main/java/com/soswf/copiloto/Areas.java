package com.soswf.copiloto;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * As areas que o motorista nao quer pegar, casadas contra o texto da oferta.
 *
 * Os termos chegam JA NORMALIZADOS do JavaScript (risco.paraOServico): sem
 * acento, minusculos, sem pontuacao. Isso e de proposito -- se o Java
 * normalizasse por conta propria, existiriam duas normalizacoes que divergem
 * na primeira correcao, e a area pararia de casar sem ninguem entender por que.
 * Aqui so o TEXTO DA TELA e normalizado, com a mesma regra.
 *
 * O casamento e por PALAVRA INTEIRA. Substring simples acharia "ana" dentro de
 * "cabana", e alarme falso mata o recurso: se apitar em corrida boa, ele para
 * de olhar o aviso, e o aviso verdadeiro passa batido junto.
 */
public final class Areas {

    private static final String ARQUIVO = "copiloto.semaforo";
    private static final String K_AREAS = "areas";

    public static final String EVITAR = "evitar";

    public final String nome;
    public final String nivel;
    private final List<String[]> termos;

    private Areas(String nome, String nivel, List<String[]> termos) {
        this.nome = nome;
        this.nivel = nivel;
        this.termos = termos;
    }

    public boolean deveRecusar() {
        return EVITAR.equals(nivel);
    }

    /* ------------------------------------------------------------ guardar */

    public static void gravar(Context contexto, String json) {
        prefs(contexto).edit().putString(K_AREAS, json == null ? "" : json).apply();
    }

    public static List<Areas> ler(Context contexto) {
        List<Areas> saida = new ArrayList<>();
        String bruto = prefs(contexto).getString(K_AREAS, "");
        if (bruto == null || bruto.isEmpty()) return saida;

        try {
            JSONArray lista = new JSONArray(bruto);
            for (int i = 0; i < lista.length(); i++) {
                JSONObject a = lista.optJSONObject(i);
                if (a == null) continue;

                JSONArray ts = a.optJSONArray("termos");
                if (ts == null || ts.length() == 0) continue;

                List<String[]> palavras = new ArrayList<>();
                for (int j = 0; j < ts.length(); j++) {
                    String termo = ts.optString(j, "").trim();
                    if (!termo.isEmpty()) palavras.add(termo.split(" "));
                }
                if (palavras.isEmpty()) continue;

                saida.add(new Areas(a.optString("nome", "Área"), a.optString("nivel", "atencao"), palavras));
            }
        } catch (Exception erro) {
            // Lista corrompida nao pode derrubar o servico: sem area, o semaforo
            // segue julgando so pelo dinheiro.
            return new ArrayList<>();
        }
        return saida;
    }

    /* ------------------------------------------------------------- casar */

    /**
     * A area mais grave que aparece no texto, ou null.
     *
     * "Nao pegar" ganha de "atencao" porque so uma cabe no selo, e a que tem de
     * aparecer e a que muda a decisao.
     */
    public static Areas casar(String texto, List<Areas> areas) {
        if (texto == null || areas == null || areas.isEmpty()) return null;

        String[] palavras = normalizar(texto).split(" ");
        Areas achada = null;

        for (Areas area : areas) {
            if (!area.aparece(palavras)) continue;
            if (area.deveRecusar()) return area;
            if (achada == null) achada = area;
        }
        return achada;
    }

    private boolean aparece(String[] palavras) {
        for (String[] termo : termos) {
            if (sequencia(palavras, termo)) return true;
        }
        return false;
    }

    /** O termo aparece como sequencia de palavras inteiras dentro do texto. */
    private static boolean sequencia(String[] texto, String[] termo) {
        if (termo.length == 0 || termo.length > texto.length) return false;
        for (int i = 0; i <= texto.length - termo.length; i++) {
            boolean bate = true;
            for (int j = 0; j < termo.length; j++) {
                if (!texto[i + j].equals(termo[j])) {
                    bate = false;
                    break;
                }
            }
            if (bate) return true;
        }
        return false;
    }

    /** Mesma regra de risco.normalizar() no JavaScript. */
    static String normalizar(String texto) {
        String semAcento = java.text.Normalizer.normalize(texto, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        return semAcento
                .toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static SharedPreferences prefs(Context contexto) {
        return contexto.getSharedPreferences(ARQUIVO, Context.MODE_PRIVATE);
    }
}
