package com.soswf.copiloto;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Versao LIMPA: sem leitura de tela e sem desenho sobre outros aplicativos.
 *
 * Existe porque o Nubank -- e os bancos brasileiros em geral -- barram aparelho
 * com servico de acessibilidade desconhecido habilitado, e com razao: ler a tela
 * de outro app e desenhar por cima dele sao exatamente as duas pernas do golpe
 * de sobreposicao. De fora, nao ha como distinguir o Copiloto de um trojan.
 *
 * Entao esta versao nao tem nada disso: nem o servico, nem a permissao de
 * sobreposicao, nem as classes que as usam. Jornada, dinheiro, GPS, rotina,
 * financeiro e orcamento continuam inteiros.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle estado) {
        super.onCreate(estado);
    }
}
