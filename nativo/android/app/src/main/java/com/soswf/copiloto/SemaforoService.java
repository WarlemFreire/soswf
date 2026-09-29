package com.soswf.copiloto;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * Le a tela do app da plataforma, acha a oferta de corrida e mostra o veredito.
 *
 * POR QUE ACESSIBILIDADE. Nao existe API para saber o que a Uber esta
 * oferecendo. A unica forma de o Copiloto ver a oferta no instante em que ela
 * aparece e ler o texto da tela, que e o que um leitor de tela faz. O motorista
 * habilita isso a mao, nas configuracoes do Android, e pode desligar quando
 * quiser -- nada aqui e silencioso.
 *
 * NADA SAI DO APARELHO. O texto lido nunca e gravado em disco nem enviado a
 * lugar algum: dele sai um veredito, ele desenha um selo, e os numeros vao para
 * o app para entrar no historico. Le tela de app de corrida, nao de banco nem
 * de mensagem -- e por isso o filtro de pacote existe, mesmo com o casamento de
 * padrao ja limitando o alcance.
 *
 * O SERVICO E O PROCESSO. Ele roda separado do WebView e continua vivo com o
 * app fechado. Por isso os cortes vem de SharedPreferences (Pisos), gravados
 * pelo lado JavaScript, que e onde a conta e testada.
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

    /** Teto de nos por varredura. Arvore de tela e funda; isto e um fusivel. */
    private static final int MAX_NOS = 400;

    /** Nao repintar o mesmo selo a cada tremulacao da tela. */
    private static final long INTERVALO_MIN_MS = 1500;

    private Sobreposicao sobreposicao;
    private long ultimoVeredito = 0;
    private String ultimaAssinatura = "";

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        sobreposicao = new Sobreposicao(this);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent evento) {
        if (evento == null) return;

        Pisos pisos = Pisos.ler(this);
        if (!pisos.ligado) return;

        CharSequence pacote = evento.getPackageName();
        if (!appDeCorrida(pacote)) return;

        long agora = System.currentTimeMillis();
        if (agora - ultimoVeredito < INTERVALO_MIN_MS) return;

        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz == null) return;

        List<String> textos = new ArrayList<>();
        try {
            colher(raiz, textos, new int[] {0});
        } finally {
            raiz.recycle();
        }

        Oferta oferta = Oferta.ler(textos);
        if (oferta == null) return;

        // A mesma oferta redesenhada nao e informacao nova.
        String assinatura = String.format(
                java.util.Locale.ROOT, "%.2f|%.2f|%.0f", oferta.valor, oferta.km, oferta.minutos);
        if (assinatura.equals(ultimaAssinatura) && agora - ultimoVeredito < 30000) return;

        Oferta.Veredito veredito = Oferta.julgar(oferta, pisos);
        // Sem piso medido nao se opina. Ver Oferta.julgar.
        if (veredito == null) return;

        ultimaAssinatura = assinatura;
        ultimoVeredito = agora;

        sobreposicao.mostrar(oferta, veredito);
        SemaforoPlugin.avisarOferta(oferta, veredito, pisos.periodo);
    }

    @Override
    public void onInterrupt() {
        if (sobreposicao != null) sobreposicao.esconder();
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
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

    /** Desce a arvore juntando texto visivel. `contador` limita o custo. */
    private static void colher(AccessibilityNodeInfo no, List<String> saida, int[] contador) {
        if (no == null || contador[0] >= MAX_NOS) return;
        contador[0]++;

        CharSequence texto = no.getText();
        if (texto != null && texto.length() > 0) saida.add(texto.toString());

        CharSequence descricao = no.getContentDescription();
        if (descricao != null && descricao.length() > 0) saida.add(descricao.toString());

        for (int i = 0; i < no.getChildCount(); i++) {
            AccessibilityNodeInfo filho = no.getChild(i);
            if (filho == null) continue;
            try {
                colher(filho, saida, contador);
            } finally {
                filho.recycle();
            }
        }
    }
}
