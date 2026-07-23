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
  var OSRM_TABLE = 'https://router.project-osrm.org/table/v1/driving/';
  // Photon (free, keyless) powers the type-ahead address suggestions.
  var PHOTON = 'https://photon.komoot.io/api/';
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

  // Core open-path optimizer over an arbitrary cost(i, j) between point indices.
  // Nearest-neighbor for an initial tour, then 2-opt. If fixStart, index 0 stays
  // first (the crew's starting location). Works for any number of stops.
  function optimizeByCost(n, cost, fixStart) {
    if (n <= 2) { var seq = []; for (var s = 0; s < n; s++) seq.push(s); return seq; }

    // Nearest-neighbor construction from index 0.
    var visited = new Array(n).fill(false);
    var order = [0];
    visited[0] = true;
    for (var k = 1; k < n; k++) {
      var last = order[order.length - 1], best = -1, bestD = Infinity;
      for (var j = 0; j < n; j++) {
        if (!visited[j]) {
          var d = cost(last, j);
          if (d < bestD) { bestD = d; best = j; }
        }
      }
      order.push(best); visited[best] = true;
    }

    // 2-opt improvement (open path, no loop back to start).
    var segCost = function (i, m) {
      var c = 0;
      if (i > 0) c += cost(order[i - 1], order[i]);
      if (m < order.length - 1) c += cost(order[m], order[m + 1]);
      return c;
    };
    var improved = true, lowerBound = fixStart ? 1 : 0;
    while (improved) {
      improved = false;
      for (var a = lowerBound; a < order.length - 1; a++) {
        for (var b = a + 1; b < order.length; b++) {
          var before = segCost(a, b);
          reverse(order, a, b);
          if (segCost(a, b) + 1e-9 < before) improved = true;
          else reverse(order, a, b); // revert
        }
      }
    }
    return order;
  }

  // Straight-line (haversine) ordering — fallback + unit tests.
  function optimizeOrder(pts, fixStart) {
    return optimizeByCost(pts.length, function (i, j) { return haversine(pts[i], pts[j]); }, fixStart);
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

  // Nominatim asks for <=1 request/second; geocode stops sequentially. Stops
  // chosen from the autocomplete (or "my location") already carry coordinates,
  // so we skip the lookup for those. onProgress(done,total) is optional.
  function geocodeAll(list, onProgress) {
    var results = [], toLookup = list.filter(function (i) {
      return typeof i.lat !== 'number' || typeof i.lng !== 'number';
    }).length, done = 0;
    return list.reduce(function (p, item) {
      return p.then(function () {
        if (typeof item.lat === 'number' && typeof item.lng === 'number') {
          results.push({ item: item, coords: { lat: item.lat, lng: item.lng } });
          return;
        }
        if (onProgress) onProgress(done + 1, toLookup);
        return geocode(item.text).then(function (coords) {
          results.push({ item: item, coords: coords });
          done += 1;
          return delay(1100);
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  }
  function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // Driving-time matrix (seconds, N×N) via OSRM /table. Powers the "fastest
  // order" optimization. Resolves to the matrix, or null if unavailable.
  function fetchDurationMatrix(pts) {
    var coordParam = pts.map(function (p) { return p.lng + ',' + p.lat; }).join(';');
    return fetch(OSRM_TABLE + coordParam + '?annotations=duration')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        if (!data || !data.durations) throw new Error('no table');
        return data.durations;
      })
      .catch(function () { return null; });
  }

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

  // Fetch the driving route once: road geometry for the map PLUS per-leg drive
  // time & distance. Resolves to {geometry, legs:[{duration,distance}], totals}
  // or null if OSRM is unavailable.
  function fetchRoute(ordered) {
    var coordParam = ordered.map(function (s) { return s.lng + ',' + s.lat; }).join(';');
    return fetch(OSRM + coordParam + '?overview=full&geometries=geojson')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        if (!data || !data.routes || !data.routes.length) throw new Error('no route');
        var route = data.routes[0];
        return {
          geometry: route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
          legs: (route.legs || []).map(function (l) { return { duration: l.duration, distance: l.distance }; }),
          totalDuration: route.duration,
          totalDistance: route.distance,
          estimated: false
        };
      })
      .catch(function () { return null; });
  }

  // Fallback when OSRM is unavailable: estimate each leg from the straight-line
  // distance at ~40 km/h (rough, but better than nothing).
  function estimateRoute(ordered) {
    var legs = [], total = 0, totDist = 0;
    for (var i = 0; i < ordered.length - 1; i++) {
      var km = haversine(ordered[i], ordered[i + 1]);
      var m = km * 1000, sec = (km / 40) * 3600;
      legs.push({ duration: sec, distance: m });
      total += sec; totDist += m;
    }
    return { geometry: null, legs: legs, totalDuration: total, totalDistance: totDist, estimated: true };
  }

  function drawRoute(ordered, geometry) {
    ensureMap();
    if (!map) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();

    var latlngs = ordered.map(function (s) { return [s.lat, s.lng]; });
    ordered.forEach(function (s, i) {
      var label = s.isStart ? 'S' : String(i + (ordered[0].isStart ? 0 : 1));
      var color = s.isStart ? '#ffffff' : '#e11b22';
      var textColor = s.isStart ? '#000' : '#fff';
      var icon = L.divIcon({
        className: 'route-pin',
        html: '<div style="background:' + color + ';color:' + textColor + ';font-weight:700;' +
          'width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
          'display:grid;place-items:center;border:2px solid #000;box-shadow:0 1px 4px rgba(0,0,0,.5)">' +
          '<span style="transform:rotate(45deg);font-size:12px">' + label + '</span></div>',
        iconSize: [28, 28], iconAnchor: [14, 28]
      });
      L.marker([s.lat, s.lng], { icon: icon })
        .bindPopup((s.isStart ? 'Start: ' : (i + 1) + '. ') + escapeHtml(s.text))
        .addTo(markerLayer);
    });
    map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 14 });

    if (geometry && geometry.length) {
      L.polyline(geometry, { color: '#e11b22', weight: 5, opacity: .9 }).addTo(routeLayer);
    } else {
      L.polyline(latlngs, { color: '#e11b22', weight: 4, opacity: .8, dashArray: '8 6' }).addTo(routeLayer);
    }
  }

  // ---------- Time / distance formatting ----------
  function fmtDur(sec) {
    if (!isFinite(sec)) return '—';
    var min = Math.round(sec / 60);
    if (min < 1) return '<1 min';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' hr' + (m ? ' ' + m + ' min' : '');
  }
  function fmtDist(m) {
    if (!isFinite(m)) return '';
    if (m < 950) return (Math.round(m / 10) * 10) + ' m';
    return (m / 1000).toFixed(1) + ' km';
  }

  // ---------- UI ----------

  var inputEl, listEl, optimizeBtn, statusEl, resultEl, orderedEl, mapsLink, totalEl, wazeLink;
  var suggestEl;                       // dropdown <ul>
  var pendingCoords = null;            // coords of the currently picked suggestion
  var suggestItems = [];               // current suggestion data
  var activeIdx = -1;                  // highlighted suggestion (keyboard)
  var suggestTimer = null, suggestSeq = 0;

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

    geocodeAll(stops, function (done, total) {
      if (total > 1) setStatus('Looking up address ' + done + ' of ' + total + '…', 'working');
    }).then(function (results) {
      var found = results.filter(function (r) { return r.coords; });
      var missing = results.filter(function (r) { return !r.coords; });
      // Don't let one bad address block the whole route — use the ones we found.
      if (found.length < 2) {
        setStatus('Need at least 2 addresses I can find. Couldn’t locate: ' +
          missing.map(function (r) { return r.item.text; }).join('; '), 'error');
        optimizeBtn.disabled = false;
        return;
      }
      var geocoded = found.map(function (r) { return Object.assign({}, r.item, r.coords); });
      // Start point (if any) is always index 0 and stays fixed.
      var startFirst = geocoded.slice().sort(function (a, b) {
        return (b.isStart ? 1 : 0) - (a.isStart ? 1 : 0);
      });
      var pts = startFirst.map(function (s) { return { lat: s.lat, lng: s.lng }; });
      var fixStart = startFirst[0].isStart;
      var warn = missing.length ? '  ·  skipped ' + missing.length + ' not found' : '';

      // Order stops by fastest DRIVING time (OSRM matrix); straight-line if it
      // isn't available.
      setStatus('Finding the fastest order…', 'working');
      fetchDurationMatrix(pts).then(function (matrix) {
        var order = matrix
          ? optimizeByCost(pts.length, function (i, j) { return matrix[i][j]; }, fixStart)
          : optimizeOrder(pts, fixStart);
        var ordered = order.map(function (idx) { return startFirst[idx]; });

        setStatus('Calculating drive times…', 'working');
        fetchRoute(ordered).then(function (route) {
          if (!route) route = estimateRoute(ordered);
          drawRoute(ordered, route.geometry);
          showResult(ordered, route);
          setStatus('Optimized ' + ordered.length + ' stops · ' + fmtDur(route.totalDuration) +
            ' total drive' + (route.estimated ? ' (estimated)' : '') + warn,
            missing.length ? 'error' : '');
          optimizeBtn.disabled = false;
        });
      });
    }).catch(function (err) {
      console.error(err);
      setStatus('Address lookup failed — check your connection and try again.', 'error');
      optimizeBtn.disabled = false;
    });
  }

  // Waze deep link to a single stop (Waze has no multi-waypoint URL).
  function wazeUrl(s) {
    return 'https://waze.com/ul?ll=' + s.lat + '%2C' + s.lng + '&navigate=yes';
  }

  function showResult(ordered, route) {
    var legs = (route && route.legs) || [];
    orderedEl.innerHTML = '';
    ordered.forEach(function (s, i) {
      var li = document.createElement('li');
      var head = document.createElement('div');
      head.className = 'ordered-head';
      var badge = document.createElement('span');
      badge.className = 'ordered-num' + (s.isStart ? ' start' : '');
      badge.textContent = s.isStart ? 'S' : String(i + (ordered[0].isStart ? 0 : 1));
      var txt = document.createElement('span');
      txt.className = 'ordered-text';
      txt.textContent = s.text + (s.isStart ? '  (start)' : '');
      head.appendChild(badge); head.appendChild(txt);
      // Per-stop Waze launch — drive straight to this stop.
      if (!s.isStart) {
        var wz = document.createElement('a');
        wz.className = 'stop-nav';
        wz.href = wazeUrl(s);
        wz.target = '_blank'; wz.rel = 'noopener';
        wz.setAttribute('aria-label', 'Navigate to this stop in Waze');
        wz.textContent = 'Waze ▸';
        head.appendChild(wz);
      }
      li.appendChild(head);
      // Drive time & distance to the next stop.
      if (i < ordered.length - 1 && legs[i]) {
        var leg = document.createElement('div');
        leg.className = 'ordered-leg';
        leg.innerHTML = '<span class="leg-arrow">↓</span> <strong>' +
          fmtDur(legs[i].duration) + '</strong> · ' + fmtDist(legs[i].distance);
        li.appendChild(leg);
      }
      orderedEl.appendChild(li);
    });

    if (route) {
      totalEl.textContent = 'Total drive: ' + fmtDur(route.totalDuration) + ' · ' +
        fmtDist(route.totalDistance) + (route.estimated ? '  (estimated)' : '');
      totalEl.classList.remove('hidden');
    } else {
      totalEl.classList.add('hidden');
    }

    // Waze "start" button → the first place to actually drive to.
    var firstTarget = (ordered[0].isStart && ordered[1]) ? ordered[1] : ordered[0];
    wazeLink.href = wazeUrl(firstTarget);

    // Google Maps full-route deep link (free; carries the whole ordered route).
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

  // ---------- Address autocomplete (Photon, free & keyless) ----------

  // Turn a Photon GeoJSON feature into a tidy suggestion.
  function formatFeature(f) {
    var p = f.properties || {};
    var streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
    var main = streetLine || p.name || p.city || p.county || p.state || 'Unknown place';
    var sub = [p.city || p.county, p.state, p.postcode].filter(Boolean).join(', ');
    var text = [main, p.city || p.county, p.state].filter(Boolean).join(', ');
    var c = (f.geometry && f.geometry.coordinates) || [];
    return { main: main, sub: sub, text: text, lat: c[1], lng: c[0] };
  }

  function fetchSuggestions(query) {
    var seq = ++suggestSeq;
    var url = PHOTON + '?q=' + encodeURIComponent(query) +
      '&limit=6&lang=en&lat=' + GTA_CENTER[0] + '&lon=' + GTA_CENTER[1];
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        if (seq !== suggestSeq) return;                 // a newer query superseded this one
        var feats = (data && data.features) || [];
        renderSuggestions(feats.map(formatFeature).filter(function (s) {
          return typeof s.lat === 'number' && typeof s.lng === 'number';
        }));
      })
      .catch(function () {
        if (seq === suggestSeq) clearSuggestions();      // network/offline: just hide it
      });
  }

  function renderSuggestions(items) {
    suggestItems = items;
    activeIdx = -1;
    suggestEl.innerHTML = '';
    if (!items.length) { clearSuggestions(); return; }
    items.forEach(function (item, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      var main = document.createElement('span');
      main.className = 'sug-main';
      main.textContent = item.main;
      li.appendChild(main);
      if (item.sub) {
        var sub = document.createElement('span');
        sub.className = 'sug-sub';
        sub.textContent = '· ' + item.sub;
        li.appendChild(sub);
      }
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();                 // keep focus in the input
        selectSuggestion(i);
      });
      suggestEl.appendChild(li);
    });
    suggestEl.classList.remove('hidden');
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function clearSuggestions() {
    suggestItems = [];
    activeIdx = -1;
    suggestEl.innerHTML = '';
    suggestEl.classList.add('hidden');
    inputEl.setAttribute('aria-expanded', 'false');
  }

  function highlight(idx) {
    var lis = suggestEl.querySelectorAll('li');
    lis.forEach(function (li, i) { li.classList.toggle('active', i === idx); });
    activeIdx = idx;
  }

  function selectSuggestion(i) {
    var item = suggestItems[i];
    if (!item) return;
    inputEl.value = item.text;             // programmatic set does not fire 'input'
    pendingCoords = { lat: item.lat, lng: item.lng };
    clearSuggestions();
  }

  // Add whatever is in the input as a stop, using picked coords when available.
  function commitInput() {
    var text = inputEl.value.trim();
    if (!text) return;
    addStop(text, false, pendingCoords);
    inputEl.value = '';
    pendingCoords = null;
    clearSuggestions();
    inputEl.focus();
  }

  function init() {
    inputEl = document.getElementById('stop-input');
    listEl = document.getElementById('stop-list');
    optimizeBtn = document.getElementById('optimize-btn');
    statusEl = document.getElementById('route-status');
    resultEl = document.getElementById('route-result');
    orderedEl = document.getElementById('ordered-stops');
    mapsLink = document.getElementById('open-maps-link');
    wazeLink = document.getElementById('open-waze-link');
    totalEl = document.getElementById('route-total');
    suggestEl = document.getElementById('suggestions');

    document.getElementById('add-stop-btn').addEventListener('click', commitInput);

    // Type-ahead: debounce, then fetch suggestions. Typing invalidates any
    // previously picked coordinates.
    inputEl.addEventListener('input', function () {
      pendingCoords = null;
      var q = inputEl.value.trim();
      if (suggestTimer) clearTimeout(suggestTimer);
      if (q.length < 3) { clearSuggestions(); return; }
      suggestTimer = setTimeout(function () { fetchSuggestions(q); }, 280);
    });

    inputEl.addEventListener('keydown', function (e) {
      var open = !suggestEl.classList.contains('hidden') && suggestItems.length;
      if (e.key === 'ArrowDown' && open) {
        e.preventDefault();
        highlight((activeIdx + 1) % suggestItems.length);
      } else if (e.key === 'ArrowUp' && open) {
        e.preventDefault();
        highlight((activeIdx - 1 + suggestItems.length) % suggestItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && activeIdx >= 0) { selectSuggestion(activeIdx); }
        else { commitInput(); }
      } else if (e.key === 'Escape') {
        clearSuggestions();
      }
    });

    // Close the dropdown when focus leaves the field.
    inputEl.addEventListener('blur', function () { setTimeout(clearSuggestions, 120); });

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
