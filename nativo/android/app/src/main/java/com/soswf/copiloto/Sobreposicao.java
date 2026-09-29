package com.soswf.copiloto;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * O selo que aparece por cima do app da plataforma com o veredito da oferta.
 *
 * Tem que ser sobreposicao do sistema, nao tela do Copiloto: quando a oferta
 * chega, quem esta na frente e a Uber. Uma tela nossa so apareceria depois de
 * ele trocar de app, e ate la a corrida expirou.
 *
 * REGRAS DE DESENHO, todas herdadas da mesma disciplina do app:
 *
 * - Cor NUNCA e a unica informacao. O selo sempre traz o numero e a palavra.
 *   Alem do daltonismo, ele le isso de relance, no escuro, dirigindo.
 * - Fica no alto e a esquerda, longe dos botoes de aceitar e recusar. Um selo
 *   sobre o botao seria pior que nao ter selo: faria ele tocar errado.
 * - Nao aceita toque (FLAG_NOT_TOUCHABLE). Nada nosso pode roubar um toque
 *   que era para a plataforma.
 * - Some sozinho. Selo esquecido na tela vira sujeira e desinforma na proxima
 *   oferta.
 */
public final class Sobreposicao {

    /** Tempo de vida do selo. A oferta tambem dura poucos segundos. */
    private static final long VIDA_MS = 12000;

    private final Context contexto;
    private final Handler mao = new Handler(Looper.getMainLooper());
    private WindowManager janelas;
    private View selo;

    public Sobreposicao(Context contexto) {
        this.contexto = contexto;
    }

    /** Sem esta permissao nada pode ser desenhado sobre outro app. */
    public static boolean permitido(Context contexto) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(contexto);
    }

    public void mostrar(Oferta oferta, Oferta.Veredito veredito, Areas area) {
        if (!permitido(contexto) || veredito == null) return;
        mao.post(() -> desenhar(oferta, veredito, area));
    }

    public void esconder() {
        mao.post(this::remover);
    }

    private void desenhar(Oferta oferta, Oferta.Veredito veredito, Areas area) {
        remover();

        if (janelas == null) {
            janelas = (WindowManager) contexto.getSystemService(Context.WINDOW_SERVICE);
        }
        if (janelas == null) return;

        selo = montarSelo(oferta, veredito, area);

        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        p.x = dp(12);
        p.y = dp(84);

        try {
            janelas.addView(selo, p);
        } catch (Exception erro) {
            // Permissao revogada no meio do turno, ou fabricante bloqueando.
            // Melhor ficar sem selo do que derrubar o servico.
            selo = null;
            return;
        }

        mao.postDelayed(this::remover, VIDA_MS);
    }

    private View montarSelo(Oferta oferta, Oferta.Veredito veredito, Areas area) {
        LinearLayout caixa = new LinearLayout(contexto);
        caixa.setOrientation(LinearLayout.VERTICAL);
        caixa.setPadding(dp(14), dp(10), dp(14), dp(12));

        GradientDrawable fundo = new GradientDrawable();
        fundo.setCornerRadius(dp(16));
        fundo.setColor(Color.parseColor("#0B0F14"));
        fundo.setStroke(dp(3), cor(veredito));
        caixa.setBackground(fundo);

        TextView palavra = new TextView(contexto);
        palavra.setText(palavra(veredito));
        palavra.setTextColor(cor(veredito));
        palavra.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        palavra.setTypeface(null, android.graphics.Typeface.BOLD);
        caixa.addView(palavra);

        // Os numeros que sustentam a palavra. Ele confere se quiser -- e um dia
        // vai querer, porque leitura de tela erra.
        TextView numeros = new TextView(contexto);
        numeros.setText(String.format(
                java.util.Locale.forLanguageTag("pt-BR"),
                "%.0f R$/h · %.2f R$/km%n%s em %.0f min · %.1f km",
                oferta.reaisPorHora(),
                oferta.reaisPorKm(),
                dinheiro(oferta.valor),
                oferta.minutos,
                oferta.km));
        numeros.setTextColor(Color.parseColor("#F2F6FB"));
        numeros.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        caixa.addView(numeros);

        // A area entra como LINHA PROPRIA, nao como cor: o motivo de recusar
        // muda o que ele faz. "Recusar porque paga mal" e "recusar porque e
        // area que voce marcou" sao decisoes diferentes.
        if (area != null) {
            TextView zona = new TextView(contexto);
            zona.setText((area.deveRecusar() ? "⛔ " : "⚠ ") + area.nome);
            zona.setTextColor(cor(area.deveRecusar() ? Oferta.Veredito.RECUSAR : Oferta.Veredito.FRACA));
            zona.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            zona.setTypeface(null, android.graphics.Typeface.BOLD);
            zona.setPadding(0, dp(6), 0, 0);
            caixa.addView(zona);
        }

        return caixa;
    }

    private static String dinheiro(double valor) {
        return String.format(java.util.Locale.forLanguageTag("pt-BR"), "R$ %.2f", valor);
    }

    private static String palavra(Oferta.Veredito v) {
        switch (v) {
            case RECUSAR:
                return "RECUSAR";
            case FRACA:
                return "FRACA";
            case BOA:
                return "BOA";
            default:
                return "ÓTIMA";
        }
    }

    /** As mesmas cores dos niveis do app, para o selo e a tela falarem igual. */
    private static int cor(Oferta.Veredito v) {
        switch (v) {
            case RECUSAR:
                return Color.parseColor("#FF7B7B");
            case FRACA:
                return Color.parseColor("#FFD24A");
            case BOA:
                return Color.parseColor("#56E08C");
            default:
                return Color.parseColor("#66D9FF");
        }
    }

    private void remover() {
        mao.removeCallbacksAndMessages(null);
        if (selo == null || janelas == null) return;
        try {
            janelas.removeView(selo);
        } catch (Exception erro) {
            /* ja saiu */
        }
        selo = null;
    }

    private int dp(int valor) {
        float d = contexto.getResources().getDisplayMetrics().density;
        return Math.round(valor * d);
    }
}
