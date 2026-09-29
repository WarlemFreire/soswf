package com.soswf.copiloto;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Le a tela do app da plataforma, acha a oferta de corrida e mostra o veredito.
 *
 * POR QUE ACESSIBILIDADE. Nao existe API para saber o que a Uber esta
 * oferecendo. A unica forma de ver a oferta no instante em que ela aparece e ler
 * o texto da tela, que e o que um leitor de tela faz. O motorista habilita isso
 * a mao, nas configuracoes do Android, e desliga quando quiser.
 *
 * ACHAR O CARTAO E O PONTO. A primeira versao casava os bairros contra a TELA
 * INTEIRA -- cabecalho, mapa, menus, a localizacao atual dele. Bastava o nome de
 * uma area marcada aparecer em qualquer canto do aplicativo para TODA oferta ser
 * marcada como risco. Agora o servico acha o menor pedaco da arvore que contem
 * ao mesmo tempo o dinheiro e a distancia -- esse pedaco e o cartao da oferta --
 * e so ele alimenta tanto os numeros quanto o casamento de bairro.
 *
 * E TEM QUE SER RAPIDO. Ele recusa uma corrida e a proxima ja aparece. Nada aqui
 * espera por rede, arquivo ou banco: a varredura e da arvore que o Android ja
 * tem em memoria, os cortes estao em SharedPreferences e os poligonos sao
 * aritmetica. O que custava tempo eram limites meus, nao o trabalho.
 */
public class SemaforoService extends AccessibilityService {

    /**
     * Apps de corrida conhecidos. Prefixo, para pegar variacoes do pacote sem
     * ter que adivinhar o nome exato de cada versao.
     */
    private static final String[] APPS_DE_CORRIDA = {
        "com.ubercab",   // Uber e Uber Driver
        "com.taxis99",   // 99
        "sinet.startup", // inDrive
        "com.einnovation",
    };

    /**
     * Teto de nos por varredura.
     *
     * Era 400, e isso fazia perder oferta: a arvore do app da plataforma passa
     * disso com folga, e a varredura parava antes de chegar no cartao. Percorrer
     * alguns milhares de nos ja em memoria custa poucos milissegundos.
     */
    private static final int MAX_NOS = 4000;

    /**
     * Quando o pacote e de corrida mas os numeros nao sairam, o cartao pode
     * ainda estar desenhando. Uma segunda olhada resolve, e e barata.
     */
    private static final long RETENTAR_MS = 180;

    /** A mesma oferta redesenhada nao e informacao nova. */
    private static final long MESMA_OFERTA_MS = 25000;

    private static final Pattern DINHEIRO = Pattern.compile("R\\$\\s*\\d");
    private static final Pattern DISTANCIA = Pattern.compile("\\d\\s*km\\b", Pattern.CASE_INSENSITIVE);

    private final Handler mao = new Handler(Looper.getMainLooper());
    private Sobreposicao sobreposicao;
    private String ultimaAssinatura = "";
    private long ultimoVeredito = 0;
    private boolean retentativaAgendada = false;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        sobreposicao = new Sobreposicao(this);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent evento) {
        if (evento == null) return;

        CharSequence pacote = evento.getPackageName();
        if (!appDeCorrida(pacote)) return;
        if (!Pisos.ler(this).ligado) return;

        // Sem janela de cegueira por tempo. Se ele recusa uma e a proxima entra
        // em meio segundo, a proxima tem de ser lida -- quem evita repintar a
        // mesma oferta e a assinatura dela, nao o relogio.
        olhar(pacote.toString(), true);
    }

    /**
     * Uma olhada na tela. `podeRetentar` evita que a segunda olhada agende uma
     * terceira, e assim por diante.
     */
    private void olhar(String pacote, boolean podeRetentar) {
        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz == null) return;

        Colheita colheita = new Colheita();
        try {
            varrer(raiz, colheita, 0);
        } finally {
            raiz.recycle();
        }

        // O cartao quando existe; a tela inteira como ultimo recurso, porque um
        // layout que nao separa o cartao ainda e melhor lido do que nao lido.
        List<String> doCartao = colheita.cartao != null ? colheita.cartao : colheita.tudo;
        Oferta oferta = Oferta.ler(doCartao);

        Diagnostico.guardar(
                this, pacote,
                String.join("\n", colheita.tudo),
                colheita.cartao == null ? "" : String.join("\n", colheita.cartao),
                oferta != null);

        if (oferta == null) {
            // O cartao pode estar no meio do desenho. Uma segunda olhada resolve.
            if (podeRetentar && !retentativaAgendada) {
                retentativaAgendada = true;
                mao.postDelayed(() -> {
                    retentativaAgendada = false;
                    olhar(pacote, false);
                }, RETENTAR_MS);
            }
            return;
        }

        long agora = System.currentTimeMillis();
        String assinatura = String.format(
                java.util.Locale.ROOT, "%.2f|%.2f|%.0f", oferta.valor, oferta.km, oferta.minutos);
        if (assinatura.equals(ultimaAssinatura) && agora - ultimoVeredito < MESMA_OFERTA_MS) return;

        // O bairro e casado SO contra o cartao. Contra a tela inteira, o nome de
        // uma area marcada em qualquer canto do app marcava toda oferta.
        Zonas.Achado area = Zonas.casar(this, String.join("\n", doCartao));

        Oferta.Veredito veredito = Oferta.julgar(oferta, Pisos.ler(this));
        if (veredito == null && area == null) return;

        // "Nao pegar" recusa mesmo com o dinheiro bom: ele decidiu isso antes,
        // com a cabeca fria.
        if (area != null && area.deveRecusar()) veredito = Oferta.Veredito.RECUSAR;
        if (veredito == null) return;

        ultimaAssinatura = assinatura;
        ultimoVeredito = agora;

        sobreposicao.mostrar(oferta, veredito, area);
        SemaforoPlugin.avisarOferta(oferta, veredito, Pisos.ler(this).periodo, area);
    }

    /** O texto da tela, e o menor pedaco dela que parece um cartao de oferta. */
    private static final class Colheita {
        final List<String> tudo = new ArrayList<>();
        /** O cartao: menor subarvore com dinheiro E distancia. */
        List<String> cartao = null;
        int profundidadeDoCartao = -1;
        int nos = 0;
    }

    /**
     * Desce a arvore juntando texto e devolvendo o texto da subarvore.
     *
     * Uma passagem so. A cada no, se a subarvore dele contem dinheiro E
     * distancia, ele e candidato a cartao; fica o MAIS FUNDO, que e o menor
     * pedaco que ainda contem a oferta inteira.
     */
    private static List<String> varrer(AccessibilityNodeInfo no, Colheita colheita, int profundidade) {
        List<String> meu = new ArrayList<>();
        if (no == null || colheita.nos >= MAX_NOS) return meu;
        colheita.nos++;

        CharSequence texto = no.getText();
        if (texto != null && texto.length() > 0) meu.add(texto.toString());

        CharSequence descricao = no.getContentDescription();
        if (descricao != null && descricao.length() > 0) meu.add(descricao.toString());

        for (int i = 0; i < no.getChildCount(); i++) {
            AccessibilityNodeInfo filho = no.getChild(i);
            if (filho == null) continue;
            try {
                meu.addAll(varrer(filho, colheita, profundidade + 1));
            } finally {
                filho.recycle();
            }
        }

        if (profundidade == 0) colheita.tudo.addAll(meu);

        if (profundidade > colheita.profundidadeDoCartao && pareceOferta(meu)) {
            colheita.cartao = new ArrayList<>(meu);
            colheita.profundidadeDoCartao = profundidade;
        }
        return meu;
    }

    private static boolean pareceOferta(List<String> textos) {
        String junto = String.join("\n", textos);
        return DINHEIRO.matcher(junto).find() && DISTANCIA.matcher(junto).find();
    }

    @Override
    public void onInterrupt() {
        if (sobreposicao != null) sobreposicao.esconder();
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        mao.removeCallbacksAndMessages(null);
        if (sobreposicao != null) sobreposicao.esconder();
        return super.onUnbind(intent);
    }

    private static boolean appDeCorrida(CharSequence pacote) {
        if (pacote == null) return false;
        String p = pacote.toString();
        for (String prefixo : APPS_DE_CORRIDA) {
            if (p.startsWith(prefixo)) return true;
        }
        return false;
    }
}
