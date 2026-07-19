# Woodbine Paving

A phone app (web app / PWA) for **Woodbine Paving** in the GTA, with two tools:

1. **🗺️ Route Planner** — enter the day's job addresses and get the most
   efficient driving order, drawn on a **Google Map** right inside the app.
2. **🧮 Job Calculator** — enter the area to get the price and an estimate of
   how much asphalt (in tons) the job needs.

It runs in the phone's browser and installs to the home screen. The **calculator
and address suggestions are free**; the **map uses Google Maps**, which needs a
free API key (see setup below).

---

## How to use it

### Job Calculator
- Enter **Length** and **Width** in feet. Tap **+ Add another area** for jobs
  with more than one section — they're summed together.
- **Thickness** defaults to **2 inches**; change it to match the job (it drives
  the tonnage estimate).
- **Rate** defaults to **$3.50 / sq ft**; editable if a job is priced
  differently.
- You get: **Total area**, **Cash (no tax)** price, **With HST (13%)** price, and
  **Estimated asphalt** in tons.

> **Tonnage is an estimate** — from the area and thickness using a standard
> compacted hot-mix asphalt density (≈ 145 lb/ft³). Adjust the thickness to get
> a closer estimate.

### Route Planner
- Start typing an address and a **dropdown of matching addresses** appears — tap
  one (or use the arrow keys + Enter) to fill it in, then tap **Add**. You can
  also type a full address and tap **Add** directly.
- Tap **📍 Use my current location as start** to begin from where you are.
- Tap **Optimize Route** — the app works out the shortest order and draws it on
  the map with numbered stops.
- Tap **Open in Google Maps** to hand the ordered route to Google Maps for
  turn-by-turn directions while you drive.

---

## Setup 1 — Google Maps API key (one time)

The in-app map uses Google Maps, which needs an API key on a Google account with
billing enabled. **Usage will almost certainly stay $0** (Google gives a large
free monthly credit), but a card on file is required.

1. Go to <https://console.cloud.google.com/> and create or pick a project. Tip:
   use the **same project** you'll use for Firebase below.
2. **APIs & Services → Library** — enable all three:
   - **Maps JavaScript API**
   - **Geocoding API**
   - **Directions API**
3. **APIs & Services → Credentials → Create credentials → API key.** Copy it.
4. **Restrict the key** (recommended): edit the key → **Application
   restrictions → Websites**, and add your app's address(es), e.g.
   `https://YOUR-PROJECT.web.app/*` (and `http://localhost:8099/*` while testing).
5. Open **`config.js`** and paste the key:
   ```js
   window.WOODBINE_CONFIG = { googleMapsApiKey: "PASTE_YOUR_KEY_HERE" };
   ```
   Commit the change. (The key is visible in the app — that's normal for a
   browser map; the website restriction in step 4 is what protects it.)

Until a key is added, the map area shows a short note and everything else keeps
working.

---

## Setup 2 — Firebase Hosting (one time)

Firebase Hosting is **free** (Spark plan — no billing needed for hosting).

1. Go to <https://console.firebase.google.com/>, **Add project**, and pick the
   **same Google Cloud project** from Setup 1. Enable **Hosting**.
2. Put your **project ID** in **`.firebaserc`** (replace `YOUR_FIREBASE_PROJECT_ID`).
3. Give GitHub permission to deploy:
   - Easiest: install the [Firebase CLI](https://firebase.google.com/docs/cli)
     and run `firebase init hosting:github` once — it creates the deploy secret
     and can wire up the workflow automatically.
   - Or manually: create a **service account** key (Firebase console → Project
     settings → Service accounts → Generate new private key) and add the JSON as
     a GitHub secret named **`FIREBASE_SERVICE_ACCOUNT`**
     (repo → Settings → Secrets and variables → Actions → New secret).
4. Push to `main`. The **Deploy to Firebase Hosting** GitHub Action publishes the
   app to `https://YOUR-PROJECT.web.app/`.

Prefer to deploy by hand instead of via GitHub? With the Firebase CLI installed
and `firebase login` done, run `firebase deploy --only hosting` from this folder.

> Already had this on GitHub Pages? Once Firebase is serving the app, you can
> turn Pages off: repo → **Settings → Pages → Source: None**.

Then open your Firebase URL on your phone → **Add to Home Screen** (iPhone Share
menu / Android ⋮ menu).

---

## How it works

| Feature | Service |
|--------|---------|
| Map, road route, geocoding | [Google Maps Platform](https://developers.google.com/maps) (your API key) |
| Address suggestions (type-ahead) | [Photon](https://photon.komoot.io/) (free, keyless) |
| Best stop order | Calculated on your phone (open-path nearest-neighbor + 2-opt) |
| Hosting | [Firebase Hosting](https://firebase.google.com/docs/hosting) (free) |

The calculator works offline (service worker); the map and address lookups need
an internet connection.

---

## Project layout

```
index.html          App shell + two tabs
styles.css          Styling (mobile-first)
config.js           Your Google Maps API key goes here
js/app.js           Tab navigation + PWA registration
js/calculator.js    Pricing + tonnage math
js/route.js         Google map, geocoding, route optimization
manifest.json       PWA metadata ("Add to Home Screen")
service-worker.js   Offline caching of the app
icons/              App icons
assets/             Company logo
firebase.json       Firebase Hosting config
.firebaserc         Firebase project ID
.github/workflows/  Auto-deploy to Firebase on push
```
