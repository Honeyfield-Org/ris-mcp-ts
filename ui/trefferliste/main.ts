const marker = document.getElementById('nojs-marker');

if (marker) {
  marker.hidden = true;
}

const app = document.getElementById('app');

if (app) {
  app.textContent = 'RIS Trefferliste — Platzhalter (kommt in #49)';
}
