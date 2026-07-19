/* route.js — day's stops -> most efficient driving order, drawn on a map.
 *
 * All services are free & keyless:
 *   - Map tiles:   OpenStreetMap via Leaflet
 *   - Geocoding:   Nominatim (nominatim.openstreetmap.org)
 *   - Road path:   OSRM public demo (router.project-osrm.org), with a
 *                  straight-line fallback if it's unavailable.
 * Stop ordering is solved on-device (nearest-neighbor + 2-opt), so no
 * routing/optimization API is required.
 */
(function () {
  'use strict';

  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  // Bias geocoding toward the Greater Toronto Area.
  var GTA_VIEWBOX = '-80.30,44.30,-78.50,43.10'; // left,top,right,bottom
  var GTA_CENTER = [43.72, -79.42];

  // ---- State ----
  var stops = [];            // { id, text, isStart, lat, lng }
  var nextId = 1;
  var map = null, markerLayer = null, routeLayer = null;

  // ---------- Geometry / optimization (pure, testable) ----------

  // Great-circle distance in km between [lat,lng] points.
  function haversine(a, b) {
    var R = 6371;
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function rad(d) { return d * Math.PI / 180; }

  function routeLength(order, pts) {
    var total = 0;
    for (var i = 0; i < order.length - 1; i++) {
      total += haversine(pts[order[i]], pts[order[i + 1]]);
    }
    return total;
  }

  // Order points for the shortest path. If fixStart, index 0 stays first
  // (used when the first stop is the crew's starting location).
  // Nearest-neighbor for an initial tour, improved with 2-opt.
  function optimizeOrder(pts, fixStart) {
    var n = pts.length;
    if (n <= 2) return pts.map(function (_, i) { return i; });

    // Nearest-neighbor construction.
    var startIdx = 0;
    var visited = new Array(n).fill(false);
    var order = [startIdx];
    visited[startIdx] = true;
    for (var k = 1; k < n; k++) {
      var last = order[order.length - 1];
      var best = -1, bestD = Infinity;
      for (var j = 0; j < n; j++) {
        if (!visited[j]) {
          var d = haversine(pts[last], pts[j]);
          if (d < bestD) { bestD = d; best = j; }
        }
      }
      order.push(best);
      visited[best] = true;
    }

    // 2-opt improvement (open path, not a loop back to start).
    var improved = true;
    var lowerBound = fixStart ? 1 : 0; // keep the start fixed if requested
    while (improved) {
      improved = false;
      for (var i = lowerBound; i < order.length - 1; i++) {
        for (var m = i + 1; m < order.length; m++) {
          var before = segCost(order, i, m, pts);
          reverse(order, i, m);
          var after = segCost(order, i, m, pts);
          if (after + 1e-9 < before) {
            improved = true;
          } else {
            reverse(order, i, m); // revert
          }
        }
      }
    }
    return order;
  }

  // Cost of the edges touched by reversing order[i..m], guarding array ends.
  function segCost(order, i, m, pts) {
    var c = 0;
    if (i > 0) c += haversine(pts[order[i - 1]], pts[order[i]]);
    if (m < order.length - 1) c += haversine(pts[order[m]], pts[order[m + 1]]);
    return c;
  }
  function reverse(arr, i, m) {
    while (i < m) { var t = arr[i]; arr[i] = arr[m]; arr[m] = t; i++; m--; }
  }

  // ---------- Geocoding ----------

  function geocode(query) {
    var url = NOMINATIM + '?format=json&limit=1&countrycodes=ca' +
      '&viewbox=' + encodeURIComponent(GTA_VIEWBOX) +
      '&q=' + encodeURIComponent(query);
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('geocode ' + r.status);
        return r.json();
      })
      .then(function (arr) {
        if (!arr || !arr.length) return null;
        return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
      });
  }

  // Nominatim asks for <=1 request/second; geocode stops sequentially.
  function geocodeAll(list) {
    var results = [];
    return list.reduce(function (p, item) {
      return p.then(function () {
        return geocode(item.text).then(function (coords) {
          results.push({ item: item, coords: coords });
          return delay(1100);
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  }
  function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // ---------- Map ----------

  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('map', { zoomControl: true }).setView(GTA_CENTER, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
  }

  function refreshMap() {
    ensureMap();
    if (map) setTimeout(function () { map.invalidateSize(); }, 50);
  }

  function drawRoute(ordered) {
    ensureMap();
    if (!map) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();

    var latlngs = ordered.map(function (s) { return [s.lat, s.lng]; });

    ordered.forEach(function (s, i) {
      var label = s.isStart ? 'S' : String(i + (ordered[0].isStart ? 0 : 1));
      var color = s.isStart ? '#2ecc71' : '#f5a623';
      var icon = L.divIcon({
        className: 'route-pin',
        html: '<div style="background:' + color + ';color:#111;font-weight:700;' +
          'width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
          'display:grid;place-items:center;border:2px solid #111;box-shadow:0 1px 4px rgba(0,0,0,.5)">' +
          '<span style="transform:rotate(45deg);font-size:12px">' + label + '</span></div>',
        iconSize: [28, 28], iconAnchor: [14, 28]
      });
      L.marker([s.lat, s.lng], { icon: icon })
        .bindPopup((s.isStart ? 'Start: ' : (i + 1) + '. ') + escapeHtml(s.text))
        .addTo(markerLayer);
    });

    map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 14 });

    // Try to fetch the real road path; fall back to straight lines.
    var coordParam = ordered.map(function (s) { return s.lng + ',' + s.lat; }).join(';');
    fetch(OSRM + coordParam + '?overview=full&geometries=geojson')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        if (data && data.routes && data.routes.length) {
          var line = data.routes[0].geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
          L.polyline(line, { color: '#f5a623', weight: 5, opacity: .9 }).addTo(routeLayer);
        } else { throw new Error('no route'); }
      })
      .catch(function () {
        L.polyline(latlngs, { color: '#f5a623', weight: 4, opacity: .8, dashArray: '8 6' }).addTo(routeLayer);
      });
  }

  // ---------- UI ----------

  var inputEl, listEl, optimizeBtn, statusEl, resultEl, orderedEl, mapsLink;

  function render() {
    listEl.innerHTML = '';
    stops.forEach(function (s, i) {
      var li = document.createElement('li');
      var num = document.createElement('span');
      num.className = 'stop-num' + (s.isStart ? ' start' : '');
      num.textContent = s.isStart ? 'S' : String(i + (hasStart() ? 0 : 1));
      var text = document.createElement('span');
      text.className = 'stop-text';
      text.textContent = s.text;
      var rm = document.createElement('button');
      rm.className = 'stop-remove';
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove stop');
      rm.innerHTML = '&times;';
      rm.addEventListener('click', function () { removeStop(s.id); });
      li.appendChild(num); li.appendChild(text); li.appendChild(rm);
      listEl.appendChild(li);
    });
    optimizeBtn.disabled = destinationCount() < 2;
  }

  function hasStart() { return stops.some(function (s) { return s.isStart; }); }
  function destinationCount() { return stops.filter(function (s) { return !s.isStart; }).length; }

  function addStop(text, isStart, coords) {
    text = (text || '').trim();
    if (!text) return;
    if (isStart) stops = stops.filter(function (s) { return !s.isStart; });
    var stop = { id: nextId++, text: text, isStart: !!isStart };
    if (coords) { stop.lat = coords.lat; stop.lng = coords.lng; }
    if (isStart) stops.unshift(stop); else stops.push(stop);
    render();
  }

  function removeStop(id) {
    stops = stops.filter(function (s) { return s.id !== id; });
    render();
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function optimize() {
    setStatus('Looking up addresses…', 'working');
    optimizeBtn.disabled = true;
    resultEl.classList.add('hidden');

    geocodeAll(stops).then(function (results) {
      var failed = results.filter(function (r) { return !r.coords; });
      if (failed.length) {
        setStatus('Could not find: ' + failed.map(function (r) { return r.item.text; }).join('; '), 'error');
        optimizeBtn.disabled = false;
        return;
      }
      var geocoded = results.map(function (r) {
        return Object.assign({}, r.item, r.coords);
      });
      // Start point (if any) is always index 0 and stays fixed.
      var startFirst = geocoded.slice().sort(function (a, b) {
        return (b.isStart ? 1 : 0) - (a.isStart ? 1 : 0);
      });
      var pts = startFirst.map(function (s) { return { lat: s.lat, lng: s.lng }; });
      var order = optimizeOrder(pts, startFirst[0].isStart);
      var ordered = order.map(function (idx) { return startFirst[idx]; });

      drawRoute(ordered);
      showResult(ordered);
      setStatus('Optimized ' + ordered.length + ' stops.', '');
      optimizeBtn.disabled = false;
    }).catch(function (err) {
      console.error(err);
      setStatus('Address lookup failed — check your connection and try again.', 'error');
      optimizeBtn.disabled = false;
    });
  }

  function showResult(ordered) {
    orderedEl.innerHTML = '';
    ordered.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.text + (s.isStart ? '  (start)' : '');
      orderedEl.appendChild(li);
    });
    // Google Maps handoff for turn-by-turn once driving.
    var origin = ordered[0];
    var dest = ordered[ordered.length - 1];
    var waypoints = ordered.slice(1, -1).map(function (s) { return s.lat + ',' + s.lng; }).join('|');
    var url = 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + origin.lat + ',' + origin.lng +
      '&destination=' + dest.lat + ',' + dest.lng +
      (waypoints ? '&waypoints=' + encodeURIComponent(waypoints) : '') +
      '&travelmode=driving';
    mapsLink.href = url;
    resultEl.classList.remove('hidden');
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setStatus('Location is not available on this device.', 'error');
      return;
    }
    setStatus('Getting your location…', 'working');
    navigator.geolocation.getCurrentPosition(function (pos) {
      addStop('My current location', true, { lat: pos.coords.latitude, lng: pos.coords.longitude });
      setStatus('Start set to your current location.', '');
    }, function () {
      setStatus('Could not get your location (permission denied?).', 'error');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    inputEl = document.getElementById('stop-input');
    listEl = document.getElementById('stop-list');
    optimizeBtn = document.getElementById('optimize-btn');
    statusEl = document.getElementById('route-status');
    resultEl = document.getElementById('route-result');
    orderedEl = document.getElementById('ordered-stops');
    mapsLink = document.getElementById('open-maps-link');

    document.getElementById('add-stop-btn').addEventListener('click', function () {
      addStop(inputEl.value, false);
      inputEl.value = '';
      inputEl.focus();
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { addStop(inputEl.value, false); inputEl.value = ''; }
    });
    document.getElementById('use-location-btn').addEventListener('click', useLocation);
    optimizeBtn.addEventListener('click', optimize);

    render();
    // Map is created lazily on first view of the Route tab.
    refreshMap();
  }

  window.WoodbineRoute = {
    init: init,
    refreshMap: refreshMap,
    // exposed for tests:
    haversine: haversine,
    routeLength: routeLength,
    optimizeOrder: optimizeOrder
  };
})();
