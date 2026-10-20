package io.github.rufogongora.homedashboard;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * A thin Android TV shell around the dashboard's /tv layout: one fullscreen
 * WebView pointed at the nginx container. All the UI, including D-pad
 * navigation, lives in the web app (src/components/tv, src/lib/tvNav.ts), so
 * a normal dashboard deploy updates the TV too — this APK only needs
 * reinstalling when the shell itself changes.
 */
public class MainActivity extends Activity {
    /** Optional one-time setup dropped into the app's files dir by
     * deploy.ps1 (adb run-as): {"url", "haUrl", "haToken"}. */
    private static final String CONFIG_FILE = "config.json";
    private static final String PREFS = "shell";
    private static final String PREF_URL = "url";
    /** localStorage key the dashboard keeps its login under (src/ha/connection.ts). */
    private static final String CREDENTIALS_KEY = "ha-dashboard:credentials";
    private static final long RETRY_MS = 5000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reload = this::load;
    private WebView web;
    private String dashboardUrl;
    /** The dashboard's saved-login JSON, waiting to be written into its
     * localStorage on the next page load. */
    private String pendingCredentials;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        readConfig();

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.splash));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // The page may be https (behind the reverse proxy) while camera
        // streams and album art come from Home Assistant over plain http.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebViewClient(new Client());
        setContentView(web);
        load();
    }

    private void readConfig() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        File file = new File(getFilesDir(), CONFIG_FILE);
        if (file.exists()) {
            try {
                String json = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
                JSONObject config = new JSONObject(json);
                String url = config.optString("url");
                if (!TextUtils.isEmpty(url)) prefs.edit().putString(PREF_URL, url).apply();
                String haUrl = config.optString("haUrl");
                String haToken = config.optString("haToken");
                if (!TextUtils.isEmpty(haUrl) && !TextUtils.isEmpty(haToken)) {
                    pendingCredentials = new JSONObject().put("hassUrl", haUrl).put("token", haToken).toString();
                }
            } catch (Exception e) {
                // A malformed file just means no setup; the page shows its login form.
            }
            // The token only needs to live in the page's localStorage.
            file.delete();
        }
        dashboardUrl = prefs.getString(PREF_URL, BuildConfig.DASHBOARD_URL);
    }

    private void load() {
        handler.removeCallbacks(reload);
        web.loadUrl(dashboardUrl);
    }

    private boolean isDashboard(String url) {
        Uri page = Uri.parse(url);
        Uri home = Uri.parse(dashboardUrl);
        return TextUtils.equals(page.getScheme(), home.getScheme())
                && TextUtils.equals(page.getAuthority(), home.getAuthority());
    }

    private class Client extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            if (pendingCredentials == null || !isDashboard(url)) return;
            String script = "localStorage.setItem(" + JSONObject.quote(CREDENTIALS_KEY) + ","
                    + JSONObject.quote(pendingCredentials) + ");location.reload();";
            pendingCredentials = null;
            view.evaluateJavascript(script, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // Server restarting, or the TV woke before its network did.
            String html = "<body style=\"margin:0;height:100vh;display:flex;flex-direction:column;"
                    + "align-items:center;justify-content:center;gap:12px;background:#18213f;"
                    + "color:#fff;font-family:sans-serif\">"
                    + "<div style=\"font-size:28px\">Can’t reach the dashboard</div>"
                    + "<div style=\"opacity:.7\">" + TextUtils.htmlEncode(dashboardUrl)
                    + " · retrying…</div></body>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            handler.postDelayed(reload, RETRY_MS);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The WebView is unusable after its renderer dies; start over.
            recreate();
            return true;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
            // The page closes its pop-up or steps back a level and says so;
            // "false" means it was already at the top, so Back leaves the app.
            // No tvBack at all (login form, error page): plain history.
            web.evaluateJavascript("window.tvBack ? window.tvBack() : null", handled -> {
                if ("true".equals(handled)) return;
                if ("null".equals(handled) && web.canGoBack()) web.goBack();
                else finish();
            });
        }
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(reload);
        web.destroy();
        super.onDestroy();
    }
}
