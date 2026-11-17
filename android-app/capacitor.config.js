// Azizo Android app - Capacitor config. Edit app.config.json, not this file.
//   mode "bundled" (default): the website is packed INSIDE the app (npm run sync copies it into www/).
//        The app opens with no internet for its pages and does not depend on GitHub or any web address.
//        "apiUrl" is the ordering server (leave "" until the website's backend is hosted; WhatsApp ordering still works).
//   mode "device" (default since 6.8.0): the app carries a copy of the whole system (site + ordering server + database) and runs it on the phone.
//   mode "remote": the app just opens "siteUrl" (always the latest site, but needs internet).
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.config.json'), 'utf8'));
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const hosts = ['wa.me', 'api.whatsapp.com'].concat(cfg.allowedHosts || []);
const api = String(cfg.apiUrl || '').replace(/\/+$/, '');
if (api) { if (!hostOf(api)) throw new Error('app.config.json: apiUrl is not a valid address: ' + api); hosts.push(hostOf(api)); }
const config = {
  appId: cfg.appId || 'com.azizo.app',
  appName: cfg.appName || 'Azizo',
  webDir: 'www',
  backgroundColor: '#070605',
  android: { backgroundColor: '#070605' },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#070605', showSpinner: false, androidScaleType: 'CENTER_CROP' },
    StatusBar: { style: 'DARK', backgroundColor: '#161210' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }
  },
  server: { androidScheme: 'https', allowNavigation: hosts }
};
if (cfg.mode === 'remote') {
  const url = String(cfg.siteUrl || '').replace(/\/+$/, '');
  const host = hostOf(url);
  if (!host) throw new Error('app.config.json: mode "remote" needs a valid siteUrl');
  const http = /^http:/i.test(url);
  config.server = { url, cleartext: http, errorPath: 'offline.html', allowNavigation: [host].concat(hosts) };
  config.android.allowMixedContent = http;
}
if (cfg.mode === 'device') {
  // the app runs its own server inside the phone at http://127.0.0.1:3000
  config.server = { androidScheme: 'https', allowNavigation: ['127.0.0.1', 'localhost'].concat(hosts) };
  config.android.allowMixedContent = true;
}
module.exports = config;
