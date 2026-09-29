package com.soswf.copiloto;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle estado) {
        // Plugin que mora no proprio app (e nao num pacote npm) nao e descoberto
        // sozinho: tem que ser registrado antes do bridge subir.
        registerPlugin(SemaforoPlugin.class);
        super.onCreate(estado);
    }
}
