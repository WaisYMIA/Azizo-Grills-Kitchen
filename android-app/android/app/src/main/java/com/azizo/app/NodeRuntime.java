package com.azizo.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.system.Os;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Runs the Azizo backend (Node 18 + its own database) inside the phone. Node can start only once per app process. */
public class NodeRuntime {
    private static final String TAG = "AzizoNode";
    public static final int PORT = 3000;
    private static volatile boolean started = false;
    private static volatile String error = "";
    private static volatile String phase = "idle";
    private static File dataDir;

    static { System.loadLibrary("azizo-node"); }

    private static native int startNodeWithArguments(String[] arguments, boolean redirectOutputToLogcat);

    public static synchronized void start(final Context ctx) {
        if (started) return;
        started = true;
        final Context app = ctx.getApplicationContext();
        Thread t = new Thread(null, new Runnable() {
            @Override public void run() {
                try {
                    phase = "unpacking";
                    File root = new File(app.getFilesDir(), "nodejs-project");
                    dataDir = new File(app.getFilesDir(), "data-device");
                    dataDir.mkdirs();
                    unpackIfNeeded(app, root);
                    phase = "starting";
                    Os.setenv("AZIZO_DATA", dataDir.getAbsolutePath(), true);
                    Os.setenv("HOME", app.getFilesDir().getAbsolutePath(), true);
                    Os.setenv("TMPDIR", app.getCacheDir().getAbsolutePath(), true);
                    String main = new File(root, "main.js").getAbsolutePath();
                    int code = startNodeWithArguments(new String[]{"node", main}, true);
                    error = "Node stopped (code " + code + ")";
                    phase = "stopped";
                } catch (Throwable e) {
                    Log.e(TAG, "failed", e);
                    error = String.valueOf(e);
                    phase = "failed";
                }
            }
        }, "azizo-node", 2 * 1024 * 1024);   // Node needs a bigger stack than the default
        t.start();
    }

    private static void unpackIfNeeded(Context ctx, File root) throws Exception {
        PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        String stamp = pi.versionName + "/" + pi.lastUpdateTime;
        File stampFile = new File(root, ".unpacked");
        if (stampFile.exists()) { try (RandomAccessFile f = new RandomAccessFile(stampFile, "r")) { byte[] b = new byte[(int) f.length()]; f.readFully(b); if (stamp.equals(new String(b))) return; } }
        root.mkdirs();
        try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(ctx.getAssets().open("nodejs-project.zip")))) {
            ZipEntry e; byte[] buf = new byte[64 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(root, e.getName());
                if (!out.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) continue;   // zip-slip guard
                if (e.isDirectory()) { out.mkdirs(); continue; }
                out.getParentFile().mkdirs();
                try (FileOutputStream fo = new FileOutputStream(out)) { int n; while ((n = zin.read(buf)) > 0) fo.write(buf, 0, n); }
            }
        }
        try (FileOutputStream fo = new FileOutputStream(stampFile)) { fo.write(stamp.getBytes()); }
    }

    public static boolean isUp() {
        try (Socket s = new Socket()) { s.connect(new InetSocketAddress("127.0.0.1", PORT), 300); return true; } catch (Exception e) { return false; }
    }
    public static String phase() { return phase; }
    public static String error() { return error; }

    /** Last part of the log written by main.js, for the on-screen "starting" page. */
    public static String logTail(int maxBytes) {
        try {
            if (dataDir == null) return "";
            File f = new File(dataDir, "node.log");
            if (!f.exists()) return "";
            try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
                long len = r.length(); long from = Math.max(0, len - maxBytes); r.seek(from);
                byte[] b = new byte[(int) (len - from)]; r.readFully(b); return new String(b);
            }
        } catch (Exception e) { return ""; }
    }
}
