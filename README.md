# Woodbine Paving

A phone app (web app / PWA) for **Woodbine Paving** in the GTA, with two tools:

1. **🗺️ Route Planner** — enter the day's job addresses and get the most
   efficient driving order, drawn on a map right inside the app.
2. **🧮 Job Calculator** — enter the area to get the price and an estimate of
   how much asphalt (in tons) the job needs.

It runs entirely in the phone's browser, costs **nothing to run**, and uses no
paid APIs or API keys.

---

## How to use it

### Job Calculator
- Enter **Length** and **Width** in feet. Tap **+ Add another area** for jobs
  with more than one section — they're summed together.
- **Thickness** defaults to **2 inches**; change it to match the job (it drives
  the tonnage estimate).
- **Rate** defaults to **$3.50 / sq ft**; editable if a job is priced
  differently.
- You get:
  - **Total area** in square feet
  - **Cash (no tax)** price — length × width × rate
  - **With HST (13%)** price — the cash price plus Ontario HST
  - **Estimated asphalt** in tons

> **Tonnage is an estimate.** It's calculated from the area and thickness using
> a standard compacted hot-mix asphalt density (≈ 145 lb/ft³). Real usage varies
> with compaction, waste, and base conditions — adjust the thickness to get a
> closer estimate.

### Route Planner
- Type an address and tap **Add** for each stop. Tap **📍 Use my current
  location as start** to begin the route from where you are.
- Tap **Optimize Route**. The app looks up each address, works out the shortest
  order to drive them, and draws the route on the map with numbered stops.
- Tap **Open in Google Maps** to hand the ordered route to Google Maps for
  turn-by-turn directions while you drive.

---

## Putting it on your phone (free hosting via GitHub Pages)

1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick the **main** branch and the **/ (root)** folder, then **Save**.
4. Wait ~1 minute. GitHub gives you a link like
   `https://<your-username>.github.io/WoodbinePavingApp/`.
5. Open that link on your phone, then:
   - **iPhone (Safari):** tap **Share** → **Add to Home Screen**.
   - **Android (Chrome):** tap the **⋮** menu → **Add to Home screen** /
     **Install app**.

It now behaves like a regular app icon on your phone.

---

## How it works (the free services)

Everything is free and needs no sign-up or API key:

| Feature | Service |
|--------|---------|
| Map display | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) tiles (bundled in `vendor/leaflet/`) |
| Address → map location | [Nominatim](https://nominatim.org/) (OpenStreetMap geocoder) |
| Road path on the map | [OSRM](http://project-osrm.org/) public server, with a straight-line fallback if it's unavailable |
| Best stop order | Calculated on your phone (no service needed) |

**Note:** the free Nominatim/OSRM public servers are best-effort and
rate-limited — fine for one crew's handful of daily lookups. The map and route
lookup need an internet connection; the calculator works offline.

---

## Project layout

```
index.html          App shell + two tabs
styles.css          Styling (mobile-first)
js/app.js           Tab navigation + PWA registration
js/calculator.js    Pricing + tonnage math
js/route.js         Geocoding, route optimization, map
manifest.json       PWA metadata ("Add to Home Screen")
service-worker.js   Offline caching of the app
icons/              App icons
vendor/leaflet/     Bundled map library (no CDN needed)
```
