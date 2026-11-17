package com.azizo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AzizoNodePlugin.class);   // must be registered before super.onCreate
        super.onCreate(savedInstanceState);
        NodeRuntime.start(this);                  // the on-phone Azizo server (Node 18 + its own database)
    }
}
