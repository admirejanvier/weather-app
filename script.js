"use strict";

// Open-Meteo: free, no API key required, so nothing secret ships in this file.
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10000;
const STORE_KEY = "weather-app:v1";

const $ = (id) => document.getElementById(id);
const el = {
  form: $("searchForm"), input: $("cityInput"), locate: $("locateBtn"),
  status: $("status"), matches: $("matches"), card: $("weather"),
  place: $("place"), localTime: $("localTime"), icon: $("icon"), temp: $("temp"),
  desc: $("desc"), feels: $("feels"), humidity: $("humidity"), wind: $("wind"),
  rain: $("rain"), forecast: $("forecast"), unit: $("unitBtn"),
};

const state = { units: "metric", place: null };

// WMO weather codes -> label, sky theme, day icon, night icon
const WMO = [
  [[0], "Clear sky", "clear", "☀️", "🌙"],
  [[1], "Mostly clear", "clear", "🌤️", "🌙"],
  [[2], "Partly cloudy", "cloud", "⛅", "☁️"],
  [[3], "Overcast", "cloud", "☁️", "☁️"],
  [[45, 48], "Fog", "fog", "🌫️", "🌫️"],
  [[51, 53, 55], "Drizzle", "rain", "🌦️", "🌧️"],
  [[56, 57], "Freezing drizzle", "rain", "🌧️", "🌧️"],
  [[61, 63, 65], "Rain", "rain", "🌧️", "🌧️"],
  [[66, 67], "Freezing rain", "rain", "🌧️", "🌧️"],
  [[71, 73, 75, 77], "Snow", "snow", "❄️", "❄️"],
  [[80, 81, 82], "Rain showers", "rain", "🌦️", "🌧️"],
  [[85, 86], "Snow showers", "snow", "🌨️", "🌨️"],
  [[95], "Thunderstorm", "storm", "⛈️", "⛈️"],
  [[96, 99], "Thunderstorm with hail", "storm", "⛈️", "⛈️"],
];

function describe(code, isDay = true) {
  const row = WMO.find(([codes]) => codes.includes(code));
  if (!row) return { label: "Unknown", sky: "cloud", icon: "🌡️" };
  const [, label, kind, dayIcon, nightIcon] = row;
  const sky = kind === "clear" ? (isDay ? "clear-day" : "clear-night") : kind;
  return { label, sky, icon: isDay ? dayIcon : nightIcon };
}

// ---------- Network ----------
let controller;

async function getJSON(url) {
  controller?.abort(); // a newer request cancels an older one
  const c = (controller = new AbortController());
  const timer = setTimeout(() => c.abort("timeout"), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: c.signal });
    if (!res.ok) throw new Error(`The weather service returned an error (${res.status}). Try again shortly.`);
    return await res.json();
  } catch (err) {
    if (c.signal.aborted) {
      if (c.signal.reason === "timeout") throw new Error("The request timed out. Check your connection and try again.");
      throw new Error("superseded");
    }
    if (err instanceof TypeError) throw new Error("Can't reach the weather service. Check your connection.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Search ----------
function toPlace(r) {
  const parts = [r.name, r.admin1, r.country].filter((p, i, a) => p && a.indexOf(p) === i);
  return { name: r.name, label: parts.join(", "), lat: r.latitude, lon: r.longitude };
}

async function search(query) {
  // "Paris, France" -> search "Paris", then prefer results that match "France"
  const [name, ...rest] = query.split(",");
  const hint = rest.join(" ").trim().toLowerCase();
  if (name.trim().length < 2) return setStatus("Enter at least 2 characters.", "error");

  setStatus("Searching…");
  try {
    const url = `${GEO_URL}?name=${encodeURIComponent(name.trim())}&count=10&language=en&format=json`;
    let results = (await getJSON(url)).results ?? [];
    if (hint) {
      const filtered = results.filter((r) =>
        [r.country, r.country_code, r.admin1].some((v) => v && v.toLowerCase().includes(hint)));
      if (filtered.length) results = filtered;
    }
    if (!results.length) return setStatus(`No place found for “${query}”. Check the spelling, or try “City, Country”.`, "error");

    const places = results.slice(0, 5).map(toPlace);
    showMatches(places);
    await load(places[0]);
  } catch (err) {
    fail(err);
  }
}

function showMatches(places) {
  el.matches.replaceChildren();
  if (places.length < 2) return (el.matches.hidden = true);
  places.slice(1).forEach((p) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.label;
    b.addEventListener("click", () => load(p).catch(fail));
    li.append(b);
    el.matches.append(li);
  });
  el.matches.hidden = false;
}

// ---------- Weather ----------
async function load(place) {
  setStatus("Loading forecast…");
  const imperial = state.units === "imperial";
  const params = new URLSearchParams({
    latitude: place.lat, longitude: place.lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: 6, timezone: "auto",
    temperature_unit: imperial ? "fahrenheit" : "celsius",
    wind_speed_unit: imperial ? "mph" : "kmh",
  });
  const data = await getJSON(`${FORECAST_URL}?${params}`);
  state.place = place;
  persist();
  render(place, data);
  setStatus("");
}

const deg = (v) => `${Math.round(v)}°`;

function render(place, { current: c, daily: d }) {
  const w = describe(c.weather_code, c.is_day === 1);
  const imperial = state.units === "imperial";

  document.body.dataset.sky = w.sky;
  el.place.textContent = place.label;
  el.localTime.textContent = `Local time ${c.time.slice(11, 16)}`; // API returns the place's own local time
  el.icon.textContent = w.icon;
  el.temp.textContent = deg(c.temperature_2m);
  el.desc.textContent = w.label;
  el.feels.textContent = deg(c.apparent_temperature);
  el.humidity.textContent = `${c.relative_humidity_2m}%`;
  el.wind.textContent = `${Math.round(c.wind_speed_10m)} ${imperial ? "mph" : "km/h"}`;
  el.rain.textContent = `${d.precipitation_probability_max[0] ?? 0}%`;
  el.unit.textContent = imperial ? "Switch to °C" : "Switch to °F";

  // Next 5 days, with each day's range drawn against the week's overall range
  const days = d.time.slice(1).map((date, i) => ({
    date, code: d.weather_code[i + 1], lo: d.temperature_2m_min[i + 1], hi: d.temperature_2m_max[i + 1],
  }));
  const min = Math.min(...days.map((x) => x.lo));
  const span = Math.max(...days.map((x) => x.hi)) - min || 1;

  el.forecast.replaceChildren(...days.map((x) => {
    const li = document.createElement("li");
    const day = new Date(`${x.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
    const left = ((x.lo - min) / span) * 100;
    const width = Math.max(((x.hi - x.lo) / span) * 100, 6);
    li.innerHTML =
      `<span>${day}</span><span aria-hidden="true">${describe(x.code).icon}</span>` +
      `<span class="lo">${deg(x.lo)}</span>` +
      `<span class="track"><i style="left:${left}%;width:${width}%"></i></span>` +
      `<span class="hi">${deg(x.hi)}</span>`;
    li.title = describe(x.code).label;
    return li;
  }));

  el.card.hidden = false;
}

// ---------- UI helpers ----------
function setStatus(msg, kind = "info") {
  el.status.textContent = msg;
  el.status.dataset.kind = kind;
}

function fail(err) {
  if (err.message === "superseded") return; // user started a newer search
  console.error(err);
  setStatus(err.message || "Something went wrong. Try again.", "error");
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ units: state.units, place: state.place })); } catch {}
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.units) state.units = saved.units;
    if (saved?.place) return saved.place;
  } catch {}
  return null;
}

// ---------- Events ----------
el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  search(el.input.value.trim());
});

el.unit.addEventListener("click", () => {
  state.units = state.units === "metric" ? "imperial" : "metric";
  if (state.place) load(state.place).catch(fail);
  else persist();
});

el.locate.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Your browser doesn't support location.", "error");
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      el.matches.hidden = true;
      load({ name: "Your location", label: "Your location", lat: coords.latitude, lon: coords.longitude }).catch(fail);
    },
    (err) => setStatus(err.code === 1
      ? "Location access is blocked. Allow it in your browser, or search for a city."
      : "Couldn't get your location. Search for a city instead.", "error"),
    { timeout: 10000, maximumAge: 300000 }
  );
});

// Reopen the last place the person looked at
const last = restore();
if (last) load(last).catch(fail);
