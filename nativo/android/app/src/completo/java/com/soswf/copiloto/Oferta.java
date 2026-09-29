package com.soswf.copiloto;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Le a oferta de corrida a partir dos textos da tela e diz se ela vale a pena.
 *
 * Puro de proposito: nada de Android aqui. Toda a fragilidade do recurso mora
 * neste arquivo, e uma classe sem dependencia e a que da para consertar sem
 * aparelho na mao.
 *
 * DUAS ESCALAS, E ELAS NAO SE COMPARAM. Esta e a regra mais importante do
 * projeto. O R$/km de uma CORRIDA OFERTADA fica na casa de 3,40 a 3,80. O
 * R$/km da JORNADA, que conta o km vazio, fica perto de 1,90 -- quase metade.
 * Comparar a oferta com a faixa da jornada foi o erro que fez o app mandar
 * recusar praticamente toda corrida. Por isso os pisos que chegam aqui vem da
 * distribuicao das OFERTAS dele mesmo, nunca das faixas da jornada.
 *
 * E o piso e percentil BAIXO, nao mediana: mediana reprova metade das corridas
 * por definicao.
 */
public final class Oferta {

    /** R$ 14,03 · R$14 · R$ 1.203,50 */
    private static final Pattern DINHEIRO =
            Pattern.compile("R\\$\\s*((?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{1,2})?)");

    /** 4,5 km · 4.5 km · 12km */
    private static final Pattern DISTANCIA =
            Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s*km\\b", Pattern.CASE_INSENSITIVE);

    /** 12 min · 1 h 05 min */
    private static final Pattern MINUTOS =
            Pattern.compile("(\\d+)\\s*min\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern HORAS =
            Pattern.compile("(\\d+)\\s*h(?:ora)?s?\\b", Pattern.CASE_INSENSITIVE);

    public final double valor;
    public final double km;
    public final double minutos;

    private Oferta(double valor, double km, double minutos) {
        this.valor = valor;
        this.km = km;
        this.minutos = minutos;
    }

    /**
     * Tenta montar uma oferta a partir dos textos visiveis. Devolve null quando
     * falta qualquer uma das tres grandezas -- sem as tres nao da para decidir
     * nada, e chutar aqui seria pior que ficar calado.
     */
    public static Oferta ler(List<String> textos) {
        StringBuilder tudo = new StringBuilder();
        for (String t : textos) {
            if (t != null) tudo.append(t).append('\n');
        }
        String tela = tudo.toString();

        List<Double> dinheiros = todos(DINHEIRO, tela, true);
        List<Double> distancias = todos(DISTANCIA, tela, false);
        List<Double> tempos = todos(MINUTOS, tela, false);
        List<Double> emHoras = todos(HORAS, tela, false);

        if (dinheiros.isEmpty() || distancias.isEmpty()) return null;

        // O VALOR e o maior: o cartao mostra o ganho da corrida e as vezes
        // tambem uma taxa ou um adicional menor. O maior e o que ele recebe.
        double valor = maior(dinheiros);

        // O KM e a SOMA. O cartao da Uber mostra dois trechos -- a distancia
        // ate o passageiro e a da viagem -- e o custo dele e dos dois. Usar so
        // o maior subestimaria o km e faria a corrida parecer melhor do que e.
        double km = soma(distancias);

        // O TEMPO tambem soma, pela mesma razao. Horas viram minutos.
        double minutos = soma(tempos) + soma(emHoras) * 60;

        if (valor <= 0 || km <= 0 || minutos <= 0) return null;
        return new Oferta(valor, km, minutos);
    }

    public double reaisPorKm() {
        return valor / km;
    }

    public double reaisPorHora() {
        return valor / (minutos / 60.0);
    }

    /* ------------------------------------------------------------ veredito */

    public enum Veredito {
        /** Abaixo do custo de rodar, ou abaixo do piso da hora. */
        RECUSAR,
        /** Paga, mas abaixo do que ele costuma conseguir neste horario. */
        FRACA,
        /** Na faixa normal dele. */
        BOA,
        /** Acima do que ele costuma conseguir. */
        OTIMA,
    }

    /**
     * Decide, comparando com os pisos medidos das ofertas DELE naquele horario.
     *
     * A ordem das regras importa:
     *
     * 1. Abaixo do custo por km e RECUSAR sempre. Nao e opiniao: e prejuizo,
     *    a corrida paga menos do que custa faze-la.
     * 2. Depois manda o R$/HORA, porque o recurso escasso e o tempo. Uma
     *    corrida longa de rodovia tem R$/km otimo e R$/hora medonho.
     * 3. O R$/km entra so para nao promover corrida que passa no tempo mas
     *    aperta o custo.
     *
     * Sem piso medido (historico curto) devolve null: a sobreposicao nao
     * aparece, em vez de aparecer com cor chutada.
     */
    public static Veredito julgar(Oferta oferta, Pisos pisos) {
        if (oferta == null || pisos == null || !pisos.temFaixaDeHora()) return null;

        if (pisos.custoKm > 0 && oferta.reaisPorKm() < pisos.custoKm) return Veredito.RECUSAR;

        double rh = oferta.reaisPorHora();
        if (rh < pisos.pisoHora) return Veredito.RECUSAR;

        boolean kmAperta = pisos.pisoKm > 0 && oferta.reaisPorKm() < pisos.pisoKm;
        if (rh >= pisos.otimoHora && !kmAperta) return Veredito.OTIMA;
        if (rh >= pisos.idealHora && !kmAperta) return Veredito.BOA;
        return Veredito.FRACA;
    }

    /* -------------------------------------------------------------- numeros */

    private static List<Double> todos(Pattern padrao, String texto, boolean dinheiro) {
        List<Double> achados = new ArrayList<>();
        Matcher m = padrao.matcher(texto);
        while (m.find()) {
            Double n = numero(m.group(1), dinheiro);
            if (n != null) achados.add(n);
        }
        return achados;
    }

    /**
     * Converte numero escrito em portugues. Em dinheiro o ponto e separador de
     * milhar ("1.203,50") e a virgula e decimal; em distancia nao existe
     * milhar, e tanto "4,5" quanto "4.5" sao quatro e meio.
     */
    static Double numero(String bruto, boolean dinheiro) {
        if (bruto == null) return null;
        String limpo = dinheiro ? bruto.replace(".", "").replace(',', '.') : bruto.replace(',', '.');
        try {
            double n = Double.parseDouble(limpo);
            return Double.isFinite(n) ? n : null;
        } catch (NumberFormatException erro) {
            return null;
        }
    }

    private static double soma(List<Double> valores) {
        double total = 0;
        for (Double v : valores) total += v;
        return total;
    }

    private static double maior(List<Double> valores) {
        double melhor = 0;
        for (Double v : valores) {
            if (v > melhor) melhor = v;
        }
        return melhor;
    }
}
