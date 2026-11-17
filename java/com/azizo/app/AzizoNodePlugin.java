package com.azizo.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the "starting" page ask whether the on-phone server is up, and shows its log if it is not. */
@CapacitorPlugin(name = "AzizoNode")
public class AzizoNodePlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("up", NodeRuntime.isUp());
        r.put("phase", NodeRuntime.phase());
        r.put("error", NodeRuntime.error());
        r.put("log", NodeRuntime.logTail(2500));
        call.resolve(r);
    }

    /** Node cannot be restarted inside a running app, so "restart" ends the app process; opening the app again starts it fresh. */
    @PluginMethod
    public void quit(PluginCall call) {
        call.resolve();
        getActivity().finishAffinity();
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> android.os.Process.killProcess(android.os.Process.myPid()), 300);
    }
}
