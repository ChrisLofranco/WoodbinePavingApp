/* app.js — tab navigation, PWA registration, and boot. */
(function () {
  'use strict';

  // ---- Tab navigation ----
  var tabs = document.querySelectorAll('.tab');
  var views = document.querySelectorAll('.view');

  function showView(viewId) {
    views.forEach(function (v) { v.classList.toggle('hidden', v.id !== viewId); });
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.view === viewId); });
    // Leaflet needs a size recalculation when its container becomes visible.
    if (viewId === 'route-view' && window.WoodbineRoute) {
      window.WoodbineRoute.refreshMap();
    }
  }

  // Any element with data-view navigates — bottom tabs and the home tiles.
  document.querySelectorAll('[data-view]').forEach(function (el) {
    el.addEventListener('click', function () { showView(el.dataset.view); });
  });

  // Let feature modules navigate between views.
  window.WoodbineApp = { showView: showView };

  // ---- Boot feature modules ----
  if (window.WoodbineCalculator) window.WoodbineCalculator.init();
  if (window.WoodbineRoute) window.WoodbineRoute.init();
  if (window.WoodbineJobs) window.WoodbineJobs.init();

  // ---- Service worker (offline / installable) ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
})();
