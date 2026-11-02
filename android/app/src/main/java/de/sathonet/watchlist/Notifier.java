package de.sathonet.watchlist;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Benachrichtigungen ohne Web-Push: Der Server legt jede Benachrichtigung in
 * ein Postfach (features/app.js), die App holt sie mit ihrem Geräte-Schlüssel
 * ab – im Hintergrund etwa alle 15 Minuten (JobScheduler, Android bestimmt
 * den genauen Zeitpunkt) und jedes Mal, wenn die App geöffnet wird.
 */
final class Notifier {

    static final String PREFS = "satho-net";
    private static final String KEY_TOKEN = "device_token";
    private static final String KEY_USER = "device_user";
    private static final String KEY_LAST = "last_notification";
    private static final String CHANNEL = "satho-net";
    private static final int JOB_ID = 1;

    private Notifier() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String deviceUser(Context c) {
        return prefs(c).getString(KEY_USER, "");
    }

    static boolean hasDevice(Context c) {
        return prefs(c).getString(KEY_TOKEN, null) != null;
    }

    /** Neues Gerät nach dem Login. Ein altes (anderer Nutzer) wird abgemeldet. */
    static void setDevice(Context c, String token, String user) {
        String old = prefs(c).getString(KEY_TOKEN, null);
        prefs(c).edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_USER, user)
                .remove(KEY_LAST)
                .apply();
        if (old != null) forgetOnServer(old);
        schedule(c);
        new Thread(() -> poll(c)).start();
    }

    /** Abmelden: Gerät auf dem Server löschen und Abruf beenden. */
    static void clearDevice(Context c) {
        String old = prefs(c).getString(KEY_TOKEN, null);
        prefs(c).edit().remove(KEY_TOKEN).remove(KEY_USER).remove(KEY_LAST).apply();
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
        if (old != null) forgetOnServer(old);
    }

    private static void forgetOnServer(String token) {
        new Thread(() -> {
            try {
                HttpURLConnection con = open("/api/app/device", token);
                con.setRequestMethod("DELETE");
                con.getResponseCode();
                con.disconnect();
            } catch (IOException ignored) {
            }
        }).start();
    }

    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || !hasDevice(c)) return;
        for (JobInfo job : js.getAllPendingJobs()) {
            if (job.getId() == JOB_ID) return;
        }
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, NotificationJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build());
    }

    /** "on", "off" (noch nicht erlaubt), "blocked" (abgelehnt) oder "nodevice". */
    static String state(Context c, boolean askedBefore, boolean shouldShowRationale) {
        if (!hasDevice(c)) return "nodevice";
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && !nm.areNotificationsEnabled()) {
            if (Build.VERSION.SDK_INT >= 33 && (!askedBefore || shouldShowRationale)) return "off";
            return "blocked";
        }
        return "on";
    }

    static boolean needsPermission(Context c) {
        return Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
    }

    private static HttpURLConnection open(String path, String token) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(BuildConfig.APP_URL + path).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setRequestProperty("X-Device-Token", token);
        con.setRequestProperty("User-Agent", "SathoNetApp/" + BuildConfig.VERSION_NAME);
        return con;
    }

    /** Neue Benachrichtigungen abholen und anzeigen. Läuft nicht im UI-Thread. */
    static synchronized void poll(Context c) {
        SharedPreferences p = prefs(c);
        String token = p.getString(KEY_TOKEN, null);
        if (token == null) return;
        long last = p.getLong(KEY_LAST, -1);
        try {
            HttpURLConnection con = open("/api/app/notifications" + (last >= 0 ? "?after=" + last : ""), token);
            int code = con.getResponseCode();
            if (code == 401) {
                // Gerät wurde auf der Benachrichtigungs-Seite entfernt
                con.disconnect();
                clearDevice(c);
                return;
            }
            if (code != 200) {
                con.disconnect();
                return;
            }
            JSONObject res = new JSONObject(readAll(con.getInputStream()));
            con.disconnect();
            if (!token.equals(p.getString(KEY_TOKEN, null))) return; // inzwischen abgemeldet
            JSONArray list = res.optJSONArray("notifications");
            if (list != null) {
                for (int i = 0; i < list.length(); i++) show(c, list.getJSONObject(i));
            }
            p.edit().putLong(KEY_LAST, res.optLong("last", Math.max(last, 0))).apply();
        } catch (Exception ignored) {
            // Kein Netz o. Ä. – beim nächsten Mal
        }
    }

    private static void show(Context c, JSONObject n) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || needsPermission(c)) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Satho-Net", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Logins, Freundschaftsanfragen und Nachrichten aus eigenen Skripten");
            nm.createNotificationChannel(ch);
        }

        String url = n.optString("url", "/");
        if (!url.startsWith("/") || url.startsWith("//")) url = "/";
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.APP_URL + url), c, MainActivity.class);
        int id = (int) n.optLong("id", System.currentTimeMillis());
        PendingIntent pi = PendingIntent.getActivity(c, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(c, CHANNEL)
                : new Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH);
        String body = n.optString("body", "");
        b.setSmallIcon(R.drawable.ic_bell)
                .setColor(0xFFF6A24C)
                .setContentTitle(n.optString("title", "Satho-Net"))
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setShowWhen(true);
        nm.notify(id, b.build());
    }

    static String readAll(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
