/* config.js — app configuration.
 *
 * GOOGLE MAPS SETUP
 * -----------------
 * Paste your Google Maps API key between the quotes below. Until you do, the
 * app still works — the calculator and the address suggestions run fine — but
 * the map area shows a short "add your key" note.
 *
 * How to get the key (one time):
 *   1. Go to https://console.cloud.google.com/  and pick (or create) a project.
 *      Tip: use the SAME Google project you use for Firebase.
 *   2. APIs & Services → Enable these three APIs:
 *        • Maps JavaScript API
 *        • Geocoding API
 *        • Directions API
 *   3. APIs & Services → Credentials → Create credentials → API key.
 *   4. Restrict the key (recommended): Application restrictions → "Websites",
 *      and add your app's address (e.g. https://YOUR-APP.web.app/* and, while
 *      testing, http://localhost:8099/*).
 *   5. Paste the key below and save. See README.md for the full walkthrough.
 */
window.WOODBINE_CONFIG = {
  googleMapsApiKey: ""
};
