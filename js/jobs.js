/* jobs.js — the Jobs list: saved quotes with statuses, a printable estimate,
 * and shortcuts to the route planner / calculator. Backed by WoodbineStore. */
(function () {
  'use strict';

  var listEl, emptyEl, sheetEl;
  var bizName, bizPhone, bizEmail, bizConfirm;

  var money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
  function fmtMoney(n) { return money.format(n || 0); }
  function fmtSqft(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }) + ' sq ft'; }
  function fmtTons(n) { return (n || 0).toFixed(2) + ' tons'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function statusLabel(s) {
    return s === 'scheduled' ? 'Scheduled' : s === 'done' ? 'Done' : 'Quoted';
  }

  // ---- List ----
  function renderList() {
    var jobs = window.WoodbineStore.listJobs();
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', jobs.length > 0);
    jobs.forEach(function (job) { listEl.appendChild(jobCard(job)); });
  }

  function jobCard(job) {
    var t = job.totals || {};
    var card = el('div', 'job-card');

    var top = el('div', 'job-top');
    top.appendChild(el('div', 'job-name', (job.customer && job.customer.name) || 'Unnamed job'));
    top.appendChild(el('span', 'status-badge status-' + (job.status || 'quoted'), statusLabel(job.status)));
    card.appendChild(top);

    if (job.address && job.address.text) card.appendChild(el('div', 'job-addr', job.address.text));
    card.appendChild(el('div', 'job-meta',
      fmtMoney(t.taxed) + '  ·  ' + fmtSqft(t.squareFootage) + '  ·  ' + fmtTons(t.tons)));

    var actions = el('div', 'job-actions');

    var sel = el('select', 'status-select');
    [['quoted', 'Quoted'], ['scheduled', 'Scheduled'], ['done', 'Done']].forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0];
      if ((job.status || 'quoted') === o[0]) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { job.status = sel.value; window.WoodbineStore.saveJob(job); });
    actions.appendChild(sel);

    actions.appendChild(actBtn('Estimate', 'btn-secondary', function () { printEstimate(job); }));
    actions.appendChild(actBtn('To Route', 'btn-secondary', function () { toRoute(job); }));
    actions.appendChild(actBtn('Edit', 'btn-ghost', function () { editJob(job); }));
    actions.appendChild(actBtn('Delete', 'btn-ghost job-del', function () {
      if (window.confirm('Delete this job?')) window.WoodbineStore.removeJob(job.id);
    }));
    card.appendChild(actions);
    return card;
  }

  function actBtn(label, cls, fn) {
    var b = el('button', 'btn ' + cls + ' job-btn', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function toRoute(job) {
    var addr = job.address && job.address.text;
    if (!addr) { window.alert('This job has no address to route to.'); return; }
    if (window.WoodbineRoute && window.WoodbineRoute.addStop) {
      var coords = (job.address.lat != null && job.address.lng != null)
        ? { lat: job.address.lat, lng: job.address.lng } : null;
      window.WoodbineRoute.addStop(addr, false, coords);
    }
    if (window.WoodbineApp) window.WoodbineApp.showView('route-view');
  }

  function editJob(job) {
    if (window.WoodbineCalculator && window.WoodbineCalculator.load) window.WoodbineCalculator.load(job);
    if (window.WoodbineApp) window.WoodbineApp.showView('calc-view');
  }

  // ---- Printable estimate ----
  function printEstimate(job) {
    var biz = window.WoodbineStore.getBusiness();
    var t = job.totals || {};
    var d = new Date(job.updatedAt || Date.now());
    var dateStr = d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    var estNo = 'WP-' + d.getFullYear() + '-' + String(job.id || '').replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase();

    var rows = (job.areas || []).map(function (a, i) {
      var l = num(a.length), w = num(a.width);
      return '<tr><td>Area ' + (i + 1) + '</td><td>' + l + ' ft × ' + w + ' ft</td>' +
        '<td class="num">' + fmtSqft(l * w) + '</td></tr>';
    }).join('');

    sheetEl.innerHTML =
      '<div class="est-head">' +
        '<img class="est-logo" src="assets/woodbine-logo.png" alt="Woodbine Paving Ltd." />' +
        '<div class="est-biz">' +
          '<div class="est-biz-name">' + esc(biz.name || 'Woodbine Paving Ltd.') + '</div>' +
          (biz.tagline ? '<div>' + esc(biz.tagline) + '</div>' : '') +
          (biz.phone ? '<div>' + esc(biz.phone) + '</div>' : '') +
          (biz.email ? '<div>' + esc(biz.email) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="est-title-row"><h1>ESTIMATE</h1>' +
        '<div class="est-meta"><div><strong>No.</strong> ' + esc(estNo) + '</div>' +
        '<div><strong>Date</strong> ' + esc(dateStr) + '</div></div></div>' +
      '<div class="est-billto"><div class="est-label">Prepared for</div>' +
        '<div class="est-cust">' + esc((job.customer && job.customer.name) || '—') + '</div>' +
        (job.address && job.address.text ? '<div>' + esc(job.address.text) + '</div>' : '') +
        (job.customer && job.customer.phone ? '<div>' + esc(job.customer.phone) + '</div>' : '') +
        (job.customer && job.customer.email ? '<div>' + esc(job.customer.email) + '</div>' : '') +
      '</div>' +
      '<table class="est-table"><thead><tr><th>Item</th><th>Dimensions</th>' +
        '<th class="num">Area</th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="2">Total area</td><td class="num">' + fmtSqft(t.squareFootage) + '</td></tr></tfoot>' +
      '</table>' +
      '<div class="est-note-line">Asphalt paving at ' + fmtMoney(job.rate) + ' / sq ft  ·  ' +
        num(job.thickness) + '" thickness  ·  est. ' + fmtTons(t.tons) + ' of asphalt</div>' +
      '<div class="est-totals">' +
        '<div class="est-row"><span>Subtotal</span><span>' + fmtMoney(t.cash) + '</span></div>' +
        '<div class="est-row"><span>HST (13%)</span><span>' + fmtMoney(t.hst) + '</span></div>' +
        '<div class="est-row est-total"><span>Total</span><span>' + fmtMoney(t.taxed) + '</span></div>' +
      '</div>' +
      '<div class="est-foot">This is an estimate, not a final invoice. Asphalt tonnage is approximate ' +
        'and depends on site conditions. Estimate valid for 30 days.</div>';

    // Print once the logo has loaded so it appears on the estimate.
    var img = sheetEl.querySelector('.est-logo');
    if (img && !img.complete) {
      var fired = false;
      var go = function () { if (!fired) { fired = true; window.print(); } };
      img.addEventListener('load', go);
      img.addEventListener('error', go);
      setTimeout(go, 1000);   // fallback if the image never resolves
    } else {
      window.print();
    }
  }

  // ---- Business details ----
  function loadBusiness() {
    var b = window.WoodbineStore.getBusiness();
    bizName.value = b.name || '';
    bizPhone.value = b.phone || '';
    bizEmail.value = b.email || '';
  }
  function saveBusiness() {
    var b = window.WoodbineStore.getBusiness();
    b.name = bizName.value.trim() || 'Woodbine Paving Ltd.';
    b.phone = bizPhone.value.trim();
    b.email = bizEmail.value.trim();
    window.WoodbineStore.saveBusiness(b);
    bizConfirm.textContent = 'Saved. This appears on your estimates.';
    bizConfirm.classList.remove('hidden');
  }

  function init() {
    listEl = document.getElementById('jobs-list');
    emptyEl = document.getElementById('jobs-empty');
    sheetEl = document.getElementById('estimate-sheet');
    bizName = document.getElementById('biz-name');
    bizPhone = document.getElementById('biz-phone');
    bizEmail = document.getElementById('biz-email');
    bizConfirm = document.getElementById('biz-confirm');

    document.getElementById('biz-save-btn').addEventListener('click', saveBusiness);
    loadBusiness();
    renderList();
    window.WoodbineStore.onChange(renderList);
  }

  window.WoodbineJobs = { init: init };
})();
