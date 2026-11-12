// Azizo Android app - Capacitor config.
// The app is a native shell that loads the Azizo website, so every site
// update reaches the app without a new Play Store release.
// Edit app.config.json (siteUrl) - never edit this file for the address.
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.config.json'), 'utf8'));
const url = String(cfg.siteUrl || '').replace(/\/+$/, '');
let host = '';
try { host = new URL(url).hostname; } catch (e) { throw new Error('app.config.json: siteUrl is not a valid address: ' + url); }
const http = /^http:/i.test(url);
module.exports = {
  appId: cfg.appId || 'com.azizo.app',
  appName: cfg.appName || 'Azizo',
  webDir: 'www',
  backgroundColor: '#070605',
  server: {
    url,
    cleartext: http,                 // only true while testing on http://
    errorPath: 'offline.html',       // shown when the site cannot be reached
    allowNavigation: [host].concat(/^[\d.]+$/.test(host) || host === 'localhost' ? [] : ['www.' + host.replace(/^www\./, ''), host.replace(/^www\./, '')]).concat(['wa.me', 'api.whatsapp.com']).concat(cfg.allowedHosts || [])
  },
  android: { allowMixedContent: http, backgroundColor: '#070605' },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#070605', showSpinner: false, androidScaleType: 'CENTER_CROP' },
    StatusBar: { style: 'DARK', backgroundColor: '#161210' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }
  }
};
