package com.soswf.copiloto;

/**
 * Dublê de Pisos para o teste de Oferta.
 *
 * O Pisos de verdade fala com SharedPreferences e nao compila fora do Android.
 * Oferta.julgar() so usa estes campos -- e o testar-java.sh confere, antes de
 * rodar, que todos eles ainda existem no Pisos verdadeiro. Dublê que mente e
 * pior que nenhum teste.
 */
public final class Pisos {
    public final double pisoHora;
    public final double idealHora;
    public final double otimoHora;
    public final double pisoKm;
    public final double custoKm;

    public Pisos(double pisoHora, double idealHora, double otimoHora, double pisoKm, double custoKm) {
        this.pisoHora = pisoHora;
        this.idealHora = idealHora;
        this.otimoHora = otimoHora;
        this.pisoKm = pisoKm;
        this.custoKm = custoKm;
    }

    public boolean temFaixaDeHora() {
        return pisoHora > 0 && idealHora >= pisoHora && otimoHora >= idealHora;
    }
}
