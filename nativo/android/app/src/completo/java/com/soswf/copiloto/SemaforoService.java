package com.soswf.copiloto;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

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
     * Era 400, depois 4000, e continuava faltando. Com a oferta aparecendo por
     * cima da NAVEGACAO -- mapa, ruas, pinos, botoes -- a arvore e enorme, e o
     * orcamento acabava antes de chegar na folha da oferta. O sintoma era
     * "cartao isolado: nao" com o cartao bem na tela.
     *
     * 20000 e chute informado, nao medida: por isso o rastro agora grava quantos
     * nos foram percorridos e em quantos milissegundos. Na proxima vez isto se
     * ajusta com numero, nao com palpite.
     */
    private static final int MAX_NOS = 20000;

    /**
     * Quando o pacote e de corrida mas os numeros nao sairam, o cartao pode
     * ainda estar desenhando. Uma segunda olhada resolve, e e barata.
     */
    private static final long RETENTAR_MS = 180;

    /** A mesma oferta redesenhada nao e informacao nova. */
    private static final long MESMA_OFERTA_MS = 25000;

    private static final Pattern DINHEIRO = Pattern.compile("R\\$\\s*\\d");
    private static final Pattern DISTANCIA = Pattern.compile("\\d\\s*km\\b", Pattern.CASE_INSENSITIVE);

    /**
     * O servico em execucao, para o app poder desliga-lo.
     *
     * DESLIGAR DE VERDADE E O PONTO. O interruptor "Ligado" do Copiloto e uma
     * flag nossa, em SharedPreferences -- o aplicativo de banco nao a enxerga.
     * O que ele le e a lista do Android de servicos de acessibilidade
     * HABILITADOS, e so disableSelf() tira o nosso de la. Depois disso o banco
     * nao ve mais nada, porque de fato nao ha mais nada: o servico perde a
     * capacidade de ler tela, nao apenas a vontade.
     *
     * Religar nao da para fazer daqui: o Android exige que o proprio usuario
     * marque de novo, na tela de acessibilidade. E isso esta certo -- uma
     * permissao dessas nao deveria voltar sozinha.
     */
    private static SemaforoService emExecucao = null;

    private final Handler mao = new Handler(Looper.getMainLooper());
    private Sobreposicao sobreposicao;
    private String ultimaAssinatura = "";
    private long ultimoVeredito = 0;
    private boolean retentativaAgendada = false;

    /**
     * O filtro de pacotes que veio do XML, guardado para poder ser devolvido.
     *
     * Em diagnostico o filtro sai, para o servico ENXERGAR qual aplicativo esta
     * gerando evento. Fora do diagnostico ele volta exatamente como estava --
     * por isso guardado daqui, e nao reescrito a mao em dois lugares.
     */
    private String[] filtroDoXml;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        emExecucao = this;
        sobreposicao = new Sobreposicao(this);

        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) filtroDoXml = info.packageNames;
        revisarFiltro();
    }

    /** O leitor esta habilitado no Android neste instante? */
    public static boolean emPe() {
        return emExecucao != null;
    }

    /**
     * Desliga o leitor no nivel do Android, nao so no nosso interruptor.
     *
     * Devolve false quando o servico nem estava de pe, ou quando a versao do
     * Android e velha demais para isto (disableSelf existe desde o Android 7).
     */
    public static boolean desligarNoSistema() {
        SemaforoService servico = emExecucao;
        if (servico == null) return false;
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.N) return false;

        servico.esconderSelo();
        // disableSelf() devolve void: nao ha confirmacao aqui. Quem confirma e
        // quem chama, relendo a lista de acessibilidade do sistema -- que e a
        // fonte que o aplicativo de banco tambem le.
        servico.disableSelf();
        emExecucao = null;
        return true;
    }

    /**
     * Mostra um selo de mentira, a pedido do app.
     *
     * Separa as duas metades que, de fora, parecem o mesmo defeito: "nao
     * aparece nada" pode ser que o servico nao esteja lendo, ou que esteja
     * lendo e nao consiga desenhar. Sem isto, descobrir qual das duas exige uma
     * oferta de verdade na tela, no transito, e um palpite depois.
     *
     * O texto e o de um cartao de oferta real: assim o botao exercita tambem o
     * parser, nao so o desenho.
     */
    public static boolean mostrarTeste() {
        SemaforoService servico = emExecucao;
        if (servico == null || servico.sobreposicao == null) return false;

        Oferta falsa = Oferta.ler(java.util.Arrays.asList(
                "R$ 18,07", "10 min (1.7 km)", "14 minutos (10.0 km)"));
        if (falsa == null) return false;

        servico.sobreposicao.mostrar(falsa, Oferta.Veredito.SEM_BASE, null, 12);
        return true;
    }

    /**
     * Liga ou desliga o filtro de pacotes do Android, conforme o diagnostico.
     *
     * Com diagnostico ligado o servico recebe evento de todo aplicativo, para
     * poder dizer o nome deles. Mesmo assim ele so LE a tela de aplicativo de
     * corrida: a varredura inteira esta atras de appDeCorrida(). De banco nao
     * se guarda uma letra, nem com o diagnostico ligado.
     */
    public static void revisarFiltro() {
        SemaforoService servico = emExecucao;
        if (servico == null) return;
        try {
            AccessibilityServiceInfo info = servico.getServiceInfo();
            if (info == null) return;
            info.packageNames = Diagnostico.ligado(servico) ? null : servico.filtroDoXml;
            servico.setServiceInfo(info);
        } catch (Exception erro) {
            // Fabricante exotico pode recusar; o filtro do XML continua valendo.
        }
    }

    private void esconderSelo() {
        if (sobreposicao != null) sobreposicao.esconder();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent evento) {
        if (evento == null) return;

        CharSequence pacote = evento.getPackageName();

        // Antes do filtro, e so em diagnostico: anota QUE aplicativo gerou o
        // evento. So o nome. Sem isto, nome de pacote errado e invisivel --
        // nenhum evento chega, nada e gravado, e o sintoma e identico ao de
        // tudo funcionando menos a leitura.
        Diagnostico.contarPacote(this, pacote);

        if (!appDeCorrida(pacote)) return;

        // O evento chegou e e de app de corrida. Anotado ANTES do interruptor,
        // para "ligado=false" e "evento nunca chega" deixarem de ser o mesmo
        // sintoma.
        Pisos.marcarEvento(this, pacote);

        if (!Pisos.ler(this).ligado) return;

        // Sem janela de cegueira por tempo. Se ele recusa uma e a proxima entra
        // em meio segundo, a proxima tem de ser lida -- quem evita repintar a
        // mesma oferta e a assinatura dela, nao o relogio.
        olhar(pacote.toString(), true, evento.getSource());
    }

    /**
     * Uma olhada na tela. `podeRetentar` evita que a segunda olhada agende uma
     * terceira, e assim por diante.
     */
    private void olhar(String pacote, boolean podeRetentar, AccessibilityNodeInfo fonte) {
        List<AccessibilityNodeInfo> raizes = telasParaLer(fonte);
        if (raizes.isEmpty()) return;

        // A primeira janela que produzir uma oferta ganha; se nenhuma produzir,
        // fica a primeira, para o diagnostico ter o que mostrar.
        Colheita colheita = null;
        Oferta ofertaLida = null;
        final long comecou = System.currentTimeMillis();
        final int quantasJanelas = raizes.size();
        try {
            for (AccessibilityNodeInfo raiz : raizes) {
                // Teto de janelas: a tela toda cabe em poucas, e varrer dez
                // arvores grandes custaria o tempo que a oferta nao tem.
                if (colheita != null && colheita.nos >= MAX_NOS) break;
                Colheita c = new Colheita();
                varrer(raiz, c, 0);
                Oferta o = Oferta.ler(c.cartao != null ? c.cartao : c.tudo);
                // Se o recorte do cartao ficou apertado demais e pegou so uma
                // perna, a janela inteira ainda e do app de corrida e merece a
                // tentativa. A tela de navegacao nao passa nem assim: ela tem
                // uma perna so, recortada ou inteira.
                if (o == null && c.cartao != null) o = Oferta.ler(c.tudo);
                if (colheita == null) colheita = c;
                if (o != null) {
                    colheita = c;
                    ofertaLida = o;
                    break;
                }
            }
        } finally {
            for (AccessibilityNodeInfo raiz : raizes) {
                // A mesma arvore pode entrar pela fonte e pela janela ativa.
                // Reciclar duas vezes levanta excecao no Android antigo, e
                // derrubar o servico por causa de limpeza seria o cumulo.
                try {
                    raiz.recycle();
                } catch (Exception erro) {
                    /* ja reciclada */
                }
            }
        }
        if (colheita == null) return;

        // O cartao quando existe; a tela inteira como ultimo recurso, porque um
        // layout que nao separa o cartao ainda e melhor lido do que nao lido.
        List<String> doCartao = colheita.cartao != null ? colheita.cartao : colheita.tudo;
        Oferta oferta = ofertaLida;

        Pisos.marcarLeitura(this, oferta != null, colheita.cartao != null,
                colheita.nos, quantasJanelas, System.currentTimeMillis() - comecou);

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
                    olhar(pacote, false, null);
                }, RETENTAR_MS);
            }
            return;
        }

        // Conta aqui, e nao do lado do app: quando a oferta chega, o Copiloto
        // quase sempre esta fechado.
        Pisos.contarLida(this, Pisos.hoje());

        long agora = System.currentTimeMillis();
        String assinatura = String.format(
                java.util.Locale.ROOT, "%.2f|%.2f|%.0f", oferta.valor, oferta.km, oferta.minutos);
        if (assinatura.equals(ultimaAssinatura) && agora - ultimoVeredito < MESMA_OFERTA_MS) return;

        // O bairro e casado SO contra o cartao. Contra a tela inteira, o nome de
        // uma area marcada em qualquer canto do app marcava toda oferta.
        Zonas.Achado area = Zonas.casar(this, String.join("\n", doCartao));

        Pisos pisos = Pisos.ler(this);
        Oferta.Veredito veredito = Oferta.julgar(oferta, pisos);
        if (veredito == null && area == null) return;

        // "Nao pegar" recusa mesmo com o dinheiro bom: ele decidiu isso antes,
        // com a cabeca fria.
        if (area != null && area.deveRecusar()) veredito = Oferta.Veredito.RECUSAR;
        if (veredito == null) return;

        ultimaAssinatura = assinatura;
        ultimoVeredito = agora;

        // MINIMO_CORRIDAS do lado JavaScript. Repetido aqui so para o rotulo.
        int faltam = Math.max(0, 12 - pisos.amostra);
        sobreposicao.mostrar(oferta, veredito, area, faltam);

        // Grava SEMPRE, inclusive sem veredito. Era aqui que o recurso se
        // mordia: a faixa vinha das corridas lancadas a mao, que quem usa
        // checkpoint nao lanca, e a oferta lida -- a unica fonte que encheria
        // sozinha -- so era gravada DEPOIS de ja existir faixa.
        SemaforoPlugin.avisarOferta(oferta, veredito, pisos.periodo, area);
    }

    /**
     * TODAS as telas que da para ler agora, em ordem de confianca.
     *
     * O rastro do aparelho dele fechou esta questao: "1 nos em 1 janela".
     * Um no. Filtrando as janelas pelo pacote da Uber, eu pegava uma janela so
     * -- e vinha vazia. O teto de nos (que eu ja tinha subido de 400 para 4000
     * e para 20000, duas vezes achando que era isso) nunca foi o problema.
     *
     * Ele mesmo apontou a causa: a Uber desenha a oferta como SOBREPOSICAO, e a
     * janela que carrega o cartao nao e a que eu estava escolhendo. Entao a
     * ordem agora e:
     *
     *   1. O NO DO PROPRIO EVENTO. E o mais confiavel de todos: o Android diz
     *        qual no mudou, e subir ate a raiz dele cai exatamente na arvore
     *        certa. Eu tinha esse dado na mao desde o inicio e nunca usei.
     *   2. A janela ativa.
     *   3. Todas as outras janelas na tela.
     *
     * Sem filtrar por pacote. Quem decide o que e oferta e o CONTEUDO -- duas
     * pernas, numeros plausiveis, dinheiro -- e nao de quem e a janela. Esse
     * filtro so estava escondendo a oferta.
     *
     * O que NAO mudou: o servico so acorda com evento de aplicativo de corrida,
     * e o texto so e guardado (em diagnostico) para esses. Ler para decidir e
     * guardar sao coisas diferentes, e so a primeira ficou mais larga.
     */
    private List<AccessibilityNodeInfo> telasParaLer(AccessibilityNodeInfo fonte) {
        List<AccessibilityNodeInfo> raizes = new ArrayList<>();

        AccessibilityNodeInfo daFonte = raizDe(fonte);
        if (daFonte != null) raizes.add(daFonte);

        AccessibilityNodeInfo ativa = getRootInActiveWindow();
        if (ativa != null) raizes.add(ativa);

        try {
            List<AccessibilityWindowInfo> janelas = getWindows();
            if (janelas != null) {
                for (AccessibilityWindowInfo janela : janelas) {
                    if (janela == null) continue;
                    AccessibilityNodeInfo raiz = janela.getRoot();
                    if (raiz != null) raizes.add(raiz);
                }
            }
        } catch (Exception erro) {
            // getWindows() falha em fabricante exotico; as duas de cima bastam.
        }
        return raizes;
    }

    /** Sobe do no ate a raiz da arvore dele. */
    private static AccessibilityNodeInfo raizDe(AccessibilityNodeInfo no) {
        if (no == null) return null;
        AccessibilityNodeInfo atual = no;
        // Teto de seguranca: arvore de aplicativo nao chega perto disso, e uma
        // arvore corrompida nao pode travar o servico num laco.
        for (int i = 0; i < 80; i++) {
            AccessibilityNodeInfo pai = atual.getParent();
            if (pai == null) break;
            atual = pai;
        }
        return atual;
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
        if (emExecucao == this) emExecucao = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        if (emExecucao == this) emExecucao = null;
        super.onDestroy();
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
