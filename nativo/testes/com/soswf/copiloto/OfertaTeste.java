package com.soswf.copiloto;

import java.util.Arrays;
import java.util.List;

/**
 * Testes do parser da oferta, com texto REAL de tela.
 *
 * O caso que deu origem a este arquivo veio de um print do aparelho dele: a
 * Uber escreve "10 min" na busca e "14 minutos" na viagem, na MESMA tela. O
 * padrao era `(\d+)\s*min\b`, e o \b exige fim de palavra depois de "min" --
 * entao "14 minutos" nao casava. O tempo saia 10 em vez de 24, e o R$/h saia
 * 108 em vez de 45. Uma corrida fraca aparecia como OTIMA.
 *
 * Toda vez que um layout de verdade aparecer, o texto dele entra aqui.
 */
public final class OfertaTeste {

    private static int passou = 0;
    private static int falhou = 0;

    /** Cartao de oferta da Uber, 01/10/2026, Nova Iguacu/RJ. Transcrito do print. */
    private static final List<String> UBER_DUAS_PERNAS = Arrays.asList(
            "UberX",
            "R$ 18,07",
            "R$1,54/km aprox.",
            "4,89 (36)",
            "Verificado",
            "10 min (1.7 km)",
            "Av. Henrique Duque Estrada Mayer, Posse, São João de Meriti",
            "14 minutos (10.0 km)",
            "Rua Wilson Lago, 6, Grande Rio, São João de Meriti",
            "Selecionar");

    public static void main(String[] args) {
        Oferta o = Oferta.ler(UBER_DUAS_PERNAS);
        conferir("a oferta é lida", o != null, "veio null");
        if (o == null) { fim(); return; }

        // O proprio aplicativo da Uber escreve "R$1,54/km" nesta tela, e
        // 18,07 / 11,7 = 1,54. Os numeros abaixo sao conferiveis no print.
        perto("valor", o.valor, 18.07);
        perto("km soma as duas pernas (1,7 + 10,0)", o.km, 11.7);
        perto("minutos somam 'min' e 'minutos' (10 + 14)", o.minutos, 24);
        perto("R$/km bate com o que a Uber mostra", o.reaisPorKm(), 1.54, 0.01);
        perto("R$/h", o.reaisPorHora(), 45.18, 0.02);

        // O maior dinheiro e o ganho; "R$1,54/km" nao pode virar o valor.
        Oferta so = Oferta.ler(Arrays.asList("R$ 7,90", "R$ 31,40", "3 min (1,2 km)", "12 min (5,0 km)"));
        conferir("com duas quantias, vale a maior", so != null && so.valor == 31.40, "valor errado");

        // Sem uma das tres grandezas nao da para decidir, e chutar e pior.
        conferir("sem km, não lê", Oferta.ler(Arrays.asList("R$ 20,00", "15 min")) == null, "leu sem km");
        conferir("sem tempo, não lê", Oferta.ler(Arrays.asList("R$ 20,00", "5 km")) == null, "leu sem tempo");
        conferir("tela sem oferta não vira oferta",
                Oferta.ler(Arrays.asList("Saldo da semana", "Ganhos")) == null, "inventou oferta");

        // Outras formas de escrever tempo que ja aparecem por aí.
        tempo("'1 h 05 min' vira 65", "1 h 05 min", 65);
        tempo("'2 horas' vira 120", "2 horas", 120);
        tempo("'8 minutos' sozinho vira 8", "8 minutos", 8);
        tempo("'5 mins' vira 5", "5 mins", 5);
        tempo("'7 minuto' vira 7", "7 minuto", 7);

        // Veredito, com a escala de OFERTA (nao a da jornada).
        Pisos p = new Pisos(40, 55, 75, 2.6, 1.10);
        conferir("45 R$/h com piso 40 é FRACA",
                Oferta.julgar(o, p) == Oferta.Veredito.FRACA, "veio " + Oferta.julgar(o, p));
        conferir("sem faixa medida, SEM_BASE (o selo cinza)",
                Oferta.julgar(o, new Pisos(0, 0, 0, 0, 0)) == Oferta.Veredito.SEM_BASE, "não deu SEM_BASE");

        fim();
    }

    /** Falha limpo quando o texto nem vira oferta, em vez de estourar NullPointer. */
    private static void tempo(String nome, String escrito, double esperado) {
        Oferta o = Oferta.ler(Arrays.asList("R$ 90,00", "40 km", escrito));
        if (o == null) { conferir(nome, false, "não leu \"" + escrito + "\""); return; }
        perto(nome, o.minutos, esperado);
    }

    private static void perto(String nome, double foi, double esperado) { perto(nome, foi, esperado, 0.001); }

    private static void perto(String nome, double foi, double esperado, double tolerancia) {
        conferir(nome, Math.abs(foi - esperado) <= tolerancia,
                "esperado " + esperado + ", veio " + foi);
    }

    private static void conferir(String nome, boolean ok, String detalhe) {
        if (ok) { passou++; return; }
        falhou++;
        System.out.println("✗ " + nome + "\n  " + detalhe);
    }

    private static void fim() {
        if (falhou > 0) {
            System.out.println("✗ " + falhou + " falharam");
            System.exit(1);
        }
        System.out.println("✓ " + passou + " testes de Oferta passaram");
    }
}
