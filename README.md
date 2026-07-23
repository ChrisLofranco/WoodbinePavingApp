# Woodbine Paving

A phone app (web app / PWA) for **Woodbine Paving** in the GTA. It opens to a
**home screen** where you pick a tool:

1. **🗺️ Route Planner** — enter the day's job addresses, get the most efficient
   driving order on a map, with the **drive time and distance between each stop**.
2. **🧮 Job Calculator** — enter the area to get the price and an estimate of how
   much asphalt (in tons) the job needs.
3. **📋 Jobs** — save calculations as **quotes** tied to a customer, track their
   **status**, print a **professional estimate**, and push an address to the route.

It runs entirely in the phone's browser and costs **nothing** — no paid APIs, no
API keys, no accounts.

---

## How to use it

### Home
Open the app and tap a tile — **Route Planner**, **Job Calculator**, or **Jobs**.
The bottom bar jumps between them any time.

### Jobs (saved quotes)
- In the **Calculator**, fill in a customer name + address and tap **Save as
  quote** — it's saved to the **Jobs** tab.
- Each job shows the price, area, tons, and a **status** you can change:
  **Quoted → Scheduled → Done**.
- Per job: **Estimate** builds a printable estimate (your phone's print screen
  offers **Save as PDF** to email/hand the customer), **To Route** drops the
  address into the route planner, **Edit** reopens it in the calculator, and
  **Delete** removes it.
- Set your **business name / phone / email** once (bottom of the Jobs tab) and it
  appears on every estimate.
- Jobs are stored **on this device** (free, no account). Syncing across phones
  would be a later upgrade.

### Job Calculator
- Enter **Length** and **Width** in feet. Tap **+ Add another area** for jobs
  with more than one section — they're summed.
- **Thickness** defaults to **2"** (drives the tonnage estimate); **Rate**
  defaults to **$3.50 / sq ft** — both editable.
- You get: **Total area**, **Cash (no tax)** price, **With HST (13%)** price, and
  **Estimated asphalt** in tons. (Tonnage is an estimate from area × thickness at
  a standard hot-mix density ≈ 145 lb/ft³.)

### Route Planner
- **Starting location:** type a start address (with the same suggestions
  dropdown) and tap **Set**, or tap **📍 Use my current location**. The start is
  kept fixed at the front of the route.
- Add **as many stops as you need** — start typing an address, pick from the
  **dropdown of matches** (or arrow-keys + Enter), and tap **Add**.
- Tap **Optimize Route**. Stops are ordered for the **fastest real driving time**
  (via OSRM's time matrix; straight-line fallback if that's unavailable), shown on
  the map with numbered stops, **drive time + distance to each next stop**, and a
  **total drive time**.
- **Navigate:** tap **▸ Start in Waze** to drive to the next stop, then the
  **Waze ▸** link on each stop as you go (Waze navigates one stop at a time). Or
  tap **Open full route in Google Maps** to load the whole route at once. Both are
  free links — no account needed.
- If an address can't be found, the route is still built from the rest and tells
  you which one was skipped (one bad address no longer blocks everything).

---

## How it works (all free, no keys)

| Feature | Service |
|--------|---------|
| Map display | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) tiles (bundled in `vendor/leaflet/`) |
| Address suggestions | [Photon](https://photon.komoot.io/) (OpenStreetMap) |
| Address → map location | [Nominatim](https://nominatim.org/) (OpenStreetMap geocoder) |
| Fastest stop order | [OSRM](http://project-osrm.org/) driving-time matrix + on-device nearest-neighbor / 2-opt (straight-line fallback) |
| Road route + drive times | [OSRM](http://project-osrm.org/) public server, with a straight-line + estimated-time fallback |
| Turn-by-turn navigation | Free deep links to **Waze** (per stop) and **Google Maps** (full route) |

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
