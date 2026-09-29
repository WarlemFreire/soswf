package com.soswf.copiloto;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Versao COMPLETA: inclui o semaforo, que le a tela da plataforma e desenha o
 * selo por cima dela.
 *
 * ESTA VERSAO BRIGA COM APLICATIVO DE BANCO. Ler a tela de outro app e desenhar
 * por cima sao as duas pernas do golpe de sobreposicao, e os bancos brasileiros
 * varrem exatamente isso. Nao e falso positivo: de fora, o comportamento e
 * indistinguivel. Quem quer o semaforo aceita essa troca; quem nao quer usa a
 * versao limpa, que tem todo o resto.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle estado) {
        // Plugin que mora no proprio app nao e descoberto sozinho: tem que ser
        // registrado antes do bridge subir.
        registerPlugin(SemaforoPlugin.class);
        super.onCreate(estado);
    }
}
