package com.soswf.copiloto;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * As areas de risco: desenho no mapa, mais os nomes que as plataformas usam.
 *
 * POR QUE AS DUAS COISAS NA MESMA CLASSE. Elas respondem a metades diferentes
 * da mesma pergunta, e nenhuma sozinha cobre o caso:
 *
 *   A GEOMETRIA responde "a corrida COMECA numa area marcada". No instante da
 *   oferta o GPS sabe onde o motorista esta, e o embarque de uma corrida de
 *   aplicativo e quase sempre perto dele. Isso e coordenada: nao envelhece.
 *
 *   OS NOMES respondem "a corrida VAI para uma area marcada". O destino existe
 *   na tela apenas como texto -- nao ha coordenada dele em lugar nenhum, e
 *   traduzir texto em coordenada exigiria geocodificacao, que e rede (nao cabe
 *   em fracao de segundo, e falha em tunel) e mandaria o endereco dele para
 *   fora.
 *
 * O desenho e a identidade estavel; o nome e apelido dele. Quando a plataforma
 * renomeia o bairro, troca-se o apelido e o desenho continua valendo -- que e
 * exatamente o problema que o desenho veio resolver.
 *
 * TUDO AQUI E ARITMETICA LOCAL: ler posicao, comparar com poligonos e casar
 * palavras. Nenhuma chamada de rede, nenhum arquivo. Roda em microssegundos no
 * mesmo evento de acessibilidade que leu a tela.
 */
public final class Zonas {

    private static final String ARQUIVO = "copiloto.semaforo";
    private static final String K_ZONAS = "zonas";
    private static final String K_LAT = "posLat";
    private static final String K_LON = "posLon";
    private static final String K_QUANDO = "posQuando";

    public static final String EVITAR = "evitar";

    /** Posicao mais velha que isto nao descreve mais onde ele esta. */
    private static final long POSICAO_VALIDA_MS = 120000;

    /** Distancia em que o aviso de aproximacao dispara. Igual ao JavaScript. */
    private static final double APROXIMACAO_M = 400;

    private static final double RAIO_TERRA_M = 6371000;

    public final String nome;
    public final String nivel;
    private final boolean poligono;
    private final double lat, lon, raio;
    private final double[][] pontos;
    private final List<String[]> termos;

    private Zonas(String nome, String nivel, boolean poligono, double lat, double lon, double raio,
                  double[][] pontos, List<String[]> termos) {
        this.nome = nome;
        this.nivel = nivel;
        this.poligono = poligono;
        this.lat = lat;
        this.lon = lon;
        this.raio = raio;
        this.pontos = pontos;
        this.termos = termos;
    }

    public boolean deveRecusar() {
        return EVITAR.equals(nivel);
    }

    /** O que foi encontrado, e por qual caminho -- o motivo muda o que ele faz. */
    public static final class Achado {
        public final Zonas zona;
        /** "inicio" veio do GPS e e certo; "destino" veio do texto e e indicio. */
        public final String motivo;
        public final boolean dentro;

        Achado(Zonas zona, String motivo, boolean dentro) {
            this.zona = zona;
            this.motivo = motivo;
            this.dentro = dentro;
        }

        public boolean deveRecusar() {
            return zona.deveRecusar();
        }

        /** Texto do selo. Diz de onde veio, porque a confianca e diferente. */
        public String rotulo() {
            if ("inicio".equals(motivo)) return (dentro ? "aqui: " : "perto de: ") + zona.nome;
            return "vai para: " + zona.nome;
        }
    }

    /* ------------------------------------------------------------ guardar */

    public static void gravar(Context contexto, String json) {
        prefs(contexto).edit().putString(K_ZONAS, json == null ? "[]" : json).apply();
    }

    /** O app publica onde ele esta; o servico de acessibilidade nao tem GPS. */
    public static void gravarPosicao(Context contexto, double lat, double lon, long quando) {
        prefs(contexto).edit()
                .putFloat(K_LAT, (float) lat)
                .putFloat(K_LON, (float) lon)
                .putLong(K_QUANDO, quando)
                .apply();
    }

    public static List<Zonas> ler(Context contexto) {
        List<Zonas> saida = new ArrayList<>();
        String bruto = prefs(contexto).getString(K_ZONAS, "");
        if (bruto == null || bruto.isEmpty()) return saida;

        try {
            JSONArray lista = new JSONArray(bruto);
            for (int i = 0; i < lista.length(); i++) {
                JSONObject z = lista.optJSONObject(i);
                if (z == null) continue;

                List<String[]> termos = new ArrayList<>();
                JSONArray ts = z.optJSONArray("termos");
                if (ts != null) {
                    for (int j = 0; j < ts.length(); j++) {
                        String t = ts.optString(j, "").trim();
                        if (!t.isEmpty()) termos.add(t.split(" "));
                    }
                }

                String nome = z.optString("nome", "Área");
                String nivel = z.optString("nivel", "atencao");

                if ("poligono".equals(z.optString("tipo"))) {
                    JSONArray ps = z.optJSONArray("pontos");
                    if (ps == null || ps.length() < 3) continue;
                    double[][] pontos = new double[ps.length()][2];
                    for (int j = 0; j < ps.length(); j++) {
                        JSONObject p = ps.optJSONObject(j);
                        if (p == null) continue;
                        pontos[j][0] = p.optDouble("lat", 0);
                        pontos[j][1] = p.optDouble("lon", 0);
                    }
                    saida.add(new Zonas(nome, nivel, true, 0, 0, 0, pontos, termos));
                } else {
                    // raio 0 e zona sem desenho: so vale pelo nome. Ela existe
                    // porque so o desenho alcanca o INICIO da corrida e so o
                    // nome alcanca o DESTINO -- descartar uma metade seria jogar
                    // fora aviso que ainda serve.
                    double raio = z.optDouble("raio", 0);
                    if (raio <= 0 && termos.isEmpty()) continue;
                    saida.add(new Zonas(nome, nivel, false,
                            z.optDouble("lat", 0), z.optDouble("lon", 0), raio, null, termos));
                }
            }
        } catch (Exception erro) {
            // Lista corrompida nao derruba o servico: sem zona, o semaforo segue
            // julgando so pelo dinheiro.
            return new ArrayList<>();
        }
        return saida;
    }

    /* -------------------------------------------------------------- casar */

    /**
     * A zona mais relevante para esta oferta.
     *
     * A ORDEM E DELIBERADA. O inicio ganha do destino porque veio do GPS: e
     * onde ele comprovadamente esta, nao um nome que pode ter mudado. Dentro
     * ganha de perto pela mesma razao. E, em qualquer empate, "nao pegar" ganha
     * de "atencao" -- so um rotulo cabe no selo, e tem de ser o que muda a
     * decisao.
     */
    public static Achado casar(Context contexto, String textoDaTela) {
        List<Zonas> zonas = ler(contexto);
        if (zonas.isEmpty()) return null;

        Achado melhor = null;

        // 1. Onde ele esta agora, se a posicao ainda descreve a realidade.
        SharedPreferences p = prefs(contexto);
        long quando = p.getLong(K_QUANDO, 0);
        if (quando > 0 && System.currentTimeMillis() - quando <= POSICAO_VALIDA_MS) {
            double lat = p.getFloat(K_LAT, 0);
            double lon = p.getFloat(K_LON, 0);
            for (Zonas z : zonas) {
                double d = z.distancia(lat, lon);
                if (d > APROXIMACAO_M) continue;
                Achado candidato = new Achado(z, "inicio", d <= 0);
                if (melhor == null || prefere(candidato, melhor)) melhor = candidato;
            }
        }
        // Estar dentro de uma area e o sinal mais forte: nao ha nome que ganhe.
        if (melhor != null && melhor.dentro && melhor.deveRecusar()) return melhor;

        // 2. Para onde a corrida vai, pelo texto.
        if (textoDaTela != null) {
            String[] palavras = normalizar(textoDaTela).split(" ");
            for (Zonas z : zonas) {
                if (!z.apareceNoTexto(palavras)) continue;
                Achado candidato = new Achado(z, "destino", false);
                if (melhor == null || prefere(candidato, melhor)) melhor = candidato;
            }
        }
        return melhor;
    }

    private static boolean prefere(Achado a, Achado b) {
        // Dentro de uma area marcada ganha de tudo.
        if (a.dentro != b.dentro) return a.dentro;
        // Depois a gravidade, que e o que muda a decisao.
        if (a.deveRecusar() != b.deveRecusar()) return a.deveRecusar();
        // Empatado, o que veio do GPS ganha do que veio de nome.
        boolean aGps = "inicio".equals(a.motivo);
        boolean bGps = "inicio".equals(b.motivo);
        return aGps && !bGps;
    }

    /* ---------------------------------------------------------- geometria */

    /** Metros ate a zona. Negativo quer dizer dentro; infinito quer dizer sem desenho. */
    private double distancia(double pLat, double pLon) {
        if (!poligono && raio <= 0) return Double.MAX_VALUE;
        if (poligono) {
            if (dentroDoPoligono(pLat, pLon)) return -1;
            double menor = Double.MAX_VALUE;
            for (double[] v : pontos) menor = Math.min(menor, metros(pLat, pLon, v[0], v[1]));
            return menor;
        }
        return metros(pLat, pLon, lat, lon) - raio;
    }

    /** Lancamento de raio. Mesma conta do zonas.js. */
    private boolean dentroDoPoligono(double pLat, double pLon) {
        boolean dentro = false;
        for (int i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
            double aLat = pontos[i][0], aLon = pontos[i][1];
            double bLat = pontos[j][0], bLon = pontos[j][1];
            if (aLat > pLat != bLat > pLat) {
                double corte = ((bLon - aLon) * (pLat - aLat)) / (bLat - aLat) + aLon;
                if (pLon < corte) dentro = !dentro;
            }
        }
        return dentro;
    }

    /** Haversine, em metros. */
    static double metros(double lat1, double lon1, double lat2, double lon2) {
        double r = Math.PI / 180;
        double dLat = (lat2 - lat1) * r;
        double dLon = (lon2 - lon1) * r;
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /* --------------------------------------------------------------- nome */

    private boolean apareceNoTexto(String[] palavras) {
        for (String[] termo : termos) {
            if (sequencia(palavras, termo)) return true;
        }
        return false;
    }

    /**
     * Palavra inteira, em sequencia. Substring simples acharia "ana" dentro de
     * "cabana", e alarme falso mata o recurso: se apitar em corrida boa, ele
     * para de olhar o aviso, e o verdadeiro passa junto.
     */
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
