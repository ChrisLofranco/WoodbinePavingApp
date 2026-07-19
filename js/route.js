/* route.js — day's stops -> most efficient driving order on a Google map.
 *
 *   - Map + roads: Google Maps JavaScript API + Directions. Needs an API key in
 *                  config.js (see README); without one the map shows a short
 *                  note and the rest of the app keeps working. Straight-line
 *                  fallback if Directions is unavailable.
 *   - Suggestions: Photon (free, keyless) type-ahead in the search bar.
 *   - Geocoding:   Google Geocoder for typed addresses (addresses picked from
 *                  the suggestions dropdown already carry coordinates).
 * Stop ordering is solved on-device (nearest-neighbor + 2-opt) so the route is
 * an open path: start -> jobs, with no forced return to the start.
 */
(function () {
  'use strict';

  // Photon (free, keyless) powers the type-ahead address suggestions.
  var PHOTON = 'https://photon.komoot.io/api/';
  var GTA_CENTER = [43.72, -79.42];      // map default + suggestion bias

  // ---- State ----
  var stops = [];            // { id, text, isStart, lat, lng }
  var nextId = 1;
  var map = null, directionsRenderer = null, geocoder = null;
  var googleReady = false;               // Google Maps JS loaded + map created
  var fallbackObjs = [];                 // markers/line drawn without Directions

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

  // ---------- Google Maps loader ----------

  // Inject the Maps JS API using the key from config.js. Calls back with an
  // Error('no-key') when no key is set, or Error('load-failed') if the script
  // can't load — in both cases the app stays usable, just without the map.
  function loadGoogleMaps(cb) {
    if (window.google && window.google.maps) { cb(); return; }
    var key = (window.WOODBINE_CONFIG && window.WOODBINE_CONFIG.googleMapsApiKey) || '';
    if (!key) { cb(new Error('no-key')); return; }
    if (loadGoogleMaps._cbs) { loadGoogleMaps._cbs.push(cb); return; }
    loadGoogleMaps._cbs = [cb];
    window.__wbGmapsReady = function () {
      loadGoogleMaps._cbs.forEach(function (f) { f(); });
    };
    var s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
      '&loading=async&callback=__wbGmapsReady';
    s.async = true;
    s.onerror = function () {
      loadGoogleMaps._cbs.forEach(function (f) { f(new Error('load-failed')); });
    };
    document.head.appendChild(s);
  }

  // Dark map styling to match the app's black/red theme.
  var DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2b2b2b' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212121' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a3a' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#c9c9c9' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d0d' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }
  ];

  function showMapMessage(msg) {
    var el = document.getElementById('map');
    if (el) el.innerHTML = '<div class="map-message">' + escapeHtml(msg) + '</div>';
  }

  function ensureMap() {
    if (map || !(window.google && window.google.maps)) return;
    var el = document.getElementById('map');
    el.innerHTML = '';
    map = new google.maps.Map(el, {
      center: { lat: GTA_CENTER[0], lng: GTA_CENTER[1] },
      zoom: 10,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      styles: DARK_MAP_STYLE
    });
    directionsRenderer = new google.maps.DirectionsRenderer({
      map: map, suppressMarkers: false,
      polylineOptions: { strokeColor: '#e11b22', strokeWeight: 5, strokeOpacity: 0.9 }
    });
    geocoder = new google.maps.Geocoder();
    googleReady = true;
  }

  // Google needs a resize nudge when its container was hidden while created.
  function refreshMap() {
    if (map && window.google) google.maps.event.trigger(map, 'resize');
  }

  function clearFallback() {
    fallbackObjs.forEach(function (o) { o.setMap(null); });
    fallbackObjs = [];
  }

  function drawRoute(ordered) {
    if (!googleReady) return;
    clearFallback();
    directionsRenderer.set('directions', null);

    var toLL = function (s) { return { lat: s.lat, lng: s.lng }; };
    new google.maps.DirectionsService().route({
      origin: toLL(ordered[0]),
      destination: toLL(ordered[ordered.length - 1]),
      waypoints: ordered.slice(1, -1).map(function (s) {
        return { location: toLL(s), stopover: true };
      }),
      optimizeWaypoints: false,          // we already ordered them (open path)
      travelMode: google.maps.TravelMode.DRIVING
    }, function (res, status) {
      if (status === 'OK' && res) { directionsRenderer.setDirections(res); }
      else { drawFallback(ordered); } // e.g. too many stops, or a routing error
    });
  }

  // Straight-line route + numbered markers when Directions can't be used.
  function drawFallback(ordered) {
    var bounds = new google.maps.LatLngBounds();
    var path = ordered.map(function (s) {
      var ll = { lat: s.lat, lng: s.lng }; bounds.extend(ll); return ll;
    });
    fallbackObjs.push(new google.maps.Polyline({
      path: path, map: map, strokeColor: '#e11b22', strokeWeight: 4, strokeOpacity: 0.85
    }));
    ordered.forEach(function (s, i) {
      var label = s.isStart ? 'S' : String(i + (ordered[0].isStart ? 0 : 1));
      fallbackObjs.push(new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng }, map: map,
        label: { text: label, color: '#ffffff', fontWeight: '700' }
      }));
    });
    map.fitBounds(bounds, 40);
  }

  // ---------- Geocoding (Google) ----------

  function geocode(query) {
    return new Promise(function (resolve) {
      if (!geocoder) { resolve(null); return; }
      geocoder.geocode({ address: query, componentRestrictions: { country: 'CA' } },
        function (res, status) {
          if (status === 'OK' && res && res[0]) {
            var loc = res[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else { resolve(null); }
        });
    });
  }

  // Geocode stops sequentially. Stops picked from the suggestions dropdown (or
  // "my location") already carry coordinates, so we skip the lookup for those.
  function geocodeAll(list) {
    var results = [];
    return list.reduce(function (p, item) {
      return p.then(function () {
        if (typeof item.lat === 'number' && typeof item.lng === 'number') {
          results.push({ item: item, coords: { lat: item.lat, lng: item.lng } });
          return;
        }
        return geocode(item.text).then(function (coords) {
          results.push({ item: item, coords: coords });
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  }

  // ---------- UI ----------

  var inputEl, listEl, optimizeBtn, statusEl, resultEl, orderedEl, mapsLink;
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
    if (!googleReady) {
      setStatus('The map isn’t set up yet — add your Google Maps API key in config.js (see README).', 'error');
      return;
    }
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

    // Load Google Maps (map + geocoding + directions). Until it's ready — or if
    // there's no API key yet — the map area shows guidance while the calculator
    // and address suggestions keep working.
    loadGoogleMaps(function (err) {
      if (err) {
        showMapMessage(err.message === 'no-key'
          ? 'Add your Google Maps API key in config.js to turn on the map (see README). The calculator and address search still work without it.'
          : 'Google Maps couldn’t load — check the API key and your connection.');
        return;
      }
      ensureMap();
      refreshMap();
    });
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
