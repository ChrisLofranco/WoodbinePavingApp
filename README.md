# Woodbine Paving

A phone app (web app / PWA) for **Woodbine Paving** in the GTA. It opens to a
**home screen** where you pick a tool:

1. **🗺️ Route Planner** — enter the day's job addresses, get the most efficient
   driving order on a map, with the **drive time and distance between each stop**.
2. **🧮 Job Calculator** — enter the area to get the price and an estimate of how
   much asphalt (in tons) the job needs.

It runs entirely in the phone's browser and costs **nothing** — no paid APIs, no
API keys, no accounts.

---

## How to use it

### Home
Open the app and tap a tile — **Route Planner** or **Job Calculator**. The bottom
bar (Home / Route / Calculator) jumps between them any time.

### Job Calculator
- Enter **Length** and **Width** in feet. Tap **+ Add another area** for jobs
  with more than one section — they're summed.
- **Thickness** defaults to **2"** (drives the tonnage estimate); **Rate**
  defaults to **$3.50 / sq ft** — both editable.
- You get: **Total area**, **Cash (no tax)** price, **With HST (13%)** price, and
  **Estimated asphalt** in tons. (Tonnage is an estimate from area × thickness at
  a standard hot-mix density ≈ 145 lb/ft³.)

### Route Planner
- Start typing an address and a **dropdown of matches** appears — tap one (or
  arrow-keys + Enter) and tap **Add**. Or tap **📍 Use my current location** as
  the start.
- Tap **Optimize Route**. You get the shortest driving order on the map with
  numbered stops, plus **drive time + distance to each next stop** and a **total
  drive time** for the day.
- Tap **Open in Google Maps** to hand the ordered route to Google Maps for
  turn-by-turn while you drive (a free link — no account needed).

---

## How it works (all free, no keys)

| Feature | Service |
|--------|---------|
| Map display | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) tiles (bundled in `vendor/leaflet/`) |
| Address suggestions | [Photon](https://photon.komoot.io/) (OpenStreetMap) |
| Address → map location | [Nominatim](https://nominatim.org/) (OpenStreetMap geocoder) |
| Road route + drive times | [OSRM](http://project-osrm.org/) public server, with a straight-line + estimated-time fallback |
| Best stop order | Calculated on your phone (nearest-neighbor + 2-opt) |

The free public OSM/OSRM servers are best-effort and rate-limited — plenty for
one crew's daily use. The map and address/route lookups need an internet
connection; the **calculator works offline**.

---

## Hosting

Currently published on **GitHub Pages** from the `gh-pages` branch. To publish a
change: repo **Settings → Pages**, make sure the source is **Deploy from a
branch → `gh-pages` → /(root)**, and **Save** (that triggers a rebuild).

A **Firebase Hosting** setup is also included (`firebase.json`, `.firebaserc`,
`.github/workflows/firebase-deploy.yml`) for later, if you want fully automatic
deploys — it stays dormant until a `FIREBASE_SERVICE_ACCOUNT` secret is added.

Open the site on your phone → **Add to Home Screen** (iPhone Share menu /
Android ⋮ menu) to get the app icon.

---

## Project layout

```
index.html          App shell: Home + Route + Calculator
styles.css          Styling (mobile-first)
js/app.js           Navigation (home tiles + tabs) + PWA registration
js/calculator.js    Pricing + tonnage math
js/route.js         Leaflet map, geocoding, optimization, drive times
manifest.json       PWA metadata ("Add to Home Screen")
service-worker.js   Offline caching of the app
icons/              App icons
assets/             Company logo
vendor/leaflet/     Bundled map library (no CDN needed)
```
