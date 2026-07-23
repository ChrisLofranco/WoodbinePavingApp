/* store.js — tiny on-device store for saved jobs/quotes and business details.
 *
 * Everything is kept in the browser's localStorage on THIS device — free, no
 * account, no server. (Syncing across devices would be the later Firebase step.)
 */
(function () {
  'use strict';

  var JOBS_KEY = 'woodbine.jobs.v1';
  var BIZ_KEY = 'woodbine.business.v1';
  var listeners = [];
  var mem = {};                 // fallback if localStorage is unavailable

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return (key in mem) ? mem[key] : fallback;
    }
  }
  function write(key, value) {
    mem[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    notify();
  }
  function notify() { listeners.forEach(function (cb) { try { cb(); } catch (e) {} }); }

  function newId() {
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---- Jobs ----
  function listJobs() {
    var arr = read(JOBS_KEY, []);
    // Newest first.
    return arr.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
  function getJob(id) {
    return read(JOBS_KEY, []).filter(function (j) { return j.id === id; })[0] || null;
  }
  function saveJob(job) {
    var arr = read(JOBS_KEY, []);
    var now = Date.now();
    if (job.id) {
      var found = false;
      arr = arr.map(function (j) {
        if (j.id === job.id) { found = true; job.updatedAt = now; return job; }
        return j;
      });
      if (!found) { job.createdAt = now; job.updatedAt = now; arr.push(job); }
    } else {
      job.id = newId();
      job.createdAt = now;
      job.updatedAt = now;
      arr.push(job);
    }
    write(JOBS_KEY, arr);
    return job;
  }
  function removeJob(id) {
    write(JOBS_KEY, read(JOBS_KEY, []).filter(function (j) { return j.id !== id; }));
  }

  // ---- Business profile (used on estimates) ----
  function getBusiness() {
    return read(BIZ_KEY, { name: 'Woodbine Paving Ltd.', tagline: 'Serving the GTA', phone: '', email: '' });
  }
  function saveBusiness(biz) { write(BIZ_KEY, biz); }

  function onChange(cb) {
    listeners.push(cb);
    return function () { listeners = listeners.filter(function (f) { return f !== cb; }); };
  }

  window.WoodbineStore = {
    listJobs: listJobs,
    getJob: getJob,
    saveJob: saveJob,
    removeJob: removeJob,
    getBusiness: getBusiness,
    saveBusiness: saveBusiness,
    onChange: onChange
  };
})();
