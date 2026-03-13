/* ════════════════════════════════════════════════
   app.js — Main orchestrator (ESP8266 Version)
   Dual Leaflet Maps · 10Hz WS Streaming · Routing
   ════════════════════════════════════════════════ */

'use strict';

const App = {
  uiMap: null,
  tftMap: null,

  uiBikeMarker: null,
  tftBikeMarker: null,
  uiDestMarker: null,
  tftDestMarker: null,

  uiRouteLine: null,
  tftRouteLine: null,

  currentPos: null,
  speed: 0,
  routeGeometry: [],
  routeSteps: [],
  totalDistM: 0,
  totalDurS: 0,
  stepIndex: 0,

  navigating: false,
  navTimer: null,
  streamTimer: null,
  gpsWatchId: null,
  destination: null,

  navHz: 2,        // GPS updates are slow
  streamHz: 5,     // Stream Canvas to ESP8266 5 times a second (200 KB/s)
};

/* ──────────── HELPERS ──────────── */

function toast(msg, ms = 2800) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, ms);
}

function formatDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
function formatETA(sec) { return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

/* ──────────── LEAFLET MAPS INIT ──────────── */

function initMaps() {
  const fallback = [12.9716, 77.5946];
  // Use native dark tiles so html2canvas captures them correctly without CSS filters
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  // 1. Main Mobile UI Map
  App.uiMap = L.map('uiMap', { center: fallback, zoom: 16, zoomControl: false, attributionControl: false });
  L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(App.uiMap);

  App.uiBikeMarker = L.marker(fallback, {
    icon: L.divIcon({ className: 'bike-marker', iconSize: [18, 18], iconAnchor: [9, 9] }),
    zIndexOffset: 1000
  }).addTo(App.uiMap);

  // 2. Hidden TFT Render target Map (128x160)
  // Slightly higher zoom for the tiny screen
  App.tftMap = L.map('tftMap', {
    center: fallback, zoom: 17, zoomControl: false,
    attributionControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false
  });
  L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(App.tftMap);

  // Do not add Leaflet markers to tftMap. html2canvas renders them poorly.
  // The bike marker and destination marker will be drawn purely via crisp Canvas 2D math.

  // UI Map Interactions
  App.uiMap.on('click', e => {
    if (!App.navigating) setDestination(e.latlng.lat, e.latlng.lng);
  });

  // Start GPS
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      App.uiMap.setView(ll, 16);
      App.tftMap.setView(ll, 16);
      App.uiBikeMarker.setLatLng(ll);
    }, null, { enableHighAccuracy: true });

    App.gpsWatchId = navigator.geolocation.watchPosition(
      pos => {
        App.currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        App.speed = pos.coords.speed || 0;
        document.querySelector('.gps-dot').classList.add('active');
        document.getElementById('gpsChip').classList.add('active');

        App.uiBikeMarker.setLatLng([App.currentPos.lat, App.currentPos.lng]);
        // Update global var for canvas renderer
        MapRenderer.setBikeState(App.currentPos.lat, App.currentPos.lng, App.speed);
      },
      err => { document.querySelector('.gps-dot').classList.remove('active'); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  } else {
    toast('Geolocation not available');
  }
}

/* ──────────── DESTINATION & ROUTING ──────────── */

function setDestination(lat, lng) {
  App.destination = { lat, lng };

  if (App.uiDestMarker) App.uiMap.removeLayer(App.uiDestMarker);

  const ll = [lat, lng];
  App.uiDestMarker = L.marker(ll, { icon: L.divIcon({ className: 'dest-marker', iconSize: [14, 14], iconAnchor: [7, 14] }) }).addTo(App.uiMap);

  toast('Destination set — fetching route…');
  fetchAndDisplayRoute();
}

async function fetchAndDisplayRoute() {
  if (!App.currentPos || !App.destination) return;
  try {
    const res = await Routing.fetchRoute(App.currentPos, App.destination);
    App.routeGeometry = res.geometry;
    App.routeSteps = res.steps;
    App.totalDistM = res.distance;
    App.totalDurS = res.duration;
    App.stepIndex = 0;

    const latlngs = App.routeGeometry.map(p => [p.lat, p.lng]);

    // UI Map Line
    if (App.uiRouteLine) App.uiMap.removeLayer(App.uiRouteLine);
    App.uiRouteLine = L.polyline(latlngs, { color: '#4fc3f7', weight: 5, lineCap: 'round' }).addTo(App.uiMap);
    App.uiMap.fitBounds(App.uiRouteLine.getBounds(), { padding: [40, 40] });

    // TFT Map Line (Thinner for small display)
    if (App.tftRouteLine) App.tftMap.removeLayer(App.tftRouteLine);
    App.tftRouteLine = L.polyline(latlngs, { color: '#4fc3f7', weight: 3, lineCap: 'square' }).addTo(App.tftMap);

    // Initial Data
    document.getElementById('etaValue').textContent = formatETA(App.totalDurS);
    document.getElementById('remainValue').textContent = formatDist(App.totalDistM);

    if (App.routeSteps.length > 0) {
      const s = App.routeSteps[0];
      MapRenderer.updateTurnArrow('LEFT'); // dummy paint
      document.getElementById('uiTurnDistance').textContent = formatDist(s.distance);
      document.getElementById('uiTurnStreet').textContent = s.name || 'Start';
    }

    toast('Route ready — tap Navigate');
  } catch (err) {
    toast('Route error: ' + err.message);
  }
}

/* ──────────── NAVIGATION LOOP ──────────── */

function startNavigation() {
  if (!App.routeGeometry.length) { toast('Set destination'); return; }
  if (!App.currentPos) { toast('GPS waiting…'); return; }

  App.navigating = true;
  App.stepIndex = 0;

  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('progressWrap').classList.add('visible');
  document.getElementById('navPanel').classList.remove('collapsed');
  toast('Navigation started 🚴');

  // Logic ticks at 2 Hz
  App.navTimer = setInterval(navLogicTick, Math.round(1000 / App.navHz));

  // TFT Streaming Loop ticks at 10 Hz
  App.streamTimer = setInterval(navStreamTick, Math.round(1000 / App.streamHz));
}

function stopNavigation() {
  App.navigating = false;
  clearInterval(App.navTimer);
  clearInterval(App.streamTimer);

  document.getElementById('btnStop').classList.add('hidden');
  document.getElementById('btnStart').classList.remove('hidden');
  document.getElementById('progressWrap').classList.remove('visible');
  toast('Stopped');
}

// Low frequency logic (GPS calculations)
function navLogicTick() {
  if (!App.currentPos) return;
  const pos = App.currentPos;
  const ll = [pos.lat, pos.lng];

  // Map Centering
  App.uiMap.panTo(ll, { animate: true, duration: 0.5 });
  App.tftMap.panTo(ll, { animate: false }); // Instant snap for Canvas
  MapRenderer.setHeading(pos.heading || 0); // Assuming you add heading logic later if needed

  // Distances
  const distToDest = L.latLng(pos).distanceTo(App.destination);
  document.getElementById('remainValue').textContent = formatDist(distToDest);
  document.getElementById('etaValue').textContent = formatETA(distToDest / Math.max(App.speed || 3, 2));
  document.getElementById('progressBar').style.width = Math.max(0, ((App.totalDistM - distToDest) / App.totalDistM) * 100) + '%';
  document.getElementById('speedValue').textContent = Math.round((App.speed || 0) * 3.6);

  // Turns
  const turn = Routing.findCurrentStep(pos, App.routeSteps, App.stepIndex);
  if (turn) {
    App.stepIndex = turn.index;
    const arrowCtx = document.getElementById('uiArrowCanvas').getContext('2d');

    // UI Arrow
    arrowCtx.clearRect(0, 0, 52, 52);
    // Draw generic arrow for mobile UI (MapRenderer has specific arrows for TFT)
    arrowCtx.fillStyle = '#ffeb3b';
    arrowCtx.textAlign = 'center';
    arrowCtx.textBaseline = 'middle';
    arrowCtx.font = '24px Arial';
    arrowCtx.fillText(turn.direction.substring(0, 1), 26, 26);

    document.getElementById('uiTurnDistance').textContent = formatDist(turn.distance);
    document.getElementById('uiTurnStreet').textContent = turn.street || '';

    // TFT overlays
    MapRenderer.updateTurnArrow(turn.direction);
    MapRenderer.updateDistance(formatDist(turn.distance));

    if (turn.distance < 50 && navigator.vibrate) navigator.vibrate(80);
  }

  if (distToDest < 20) { toast('🎉 Arrived!'); stopNavigation(); }
}

// High frequency streaming loop
async function navStreamTick() {
  // Take a snapshot of everything, convert to RGB565, and blast it over WebSocket
  await MapRenderer.generateAndStreamFrame();
}

/* ──────────── UI WIRING ──────────── */

function setupUI() {
  document.getElementById('btnStart').addEventListener('click', startNavigation);
  document.getElementById('btnStop').addEventListener('click', stopNavigation);

  document.getElementById('btnConnect').addEventListener('click', async () => {
    try {
      const savedIP = localStorage.getItem('esp_ip') || '192.168.4.1';
      const userIP = prompt('Enter ESP8266 IP Address (shown on TFT screen):', savedIP);
      if (!userIP) return; // User cancelled

      localStorage.setItem('esp_ip', userIP);
      WSManager.setIP(userIP);

      toast(`Connecting to ${userIP}...`);
      const name = await WSManager.connect(() => {
        document.querySelector('.ws-dot').classList.remove('active');
        document.getElementById('wsChip').classList.remove('active');
        toast('WebSocket disconnected');
      });
      document.querySelector('.ws-dot').classList.add('active');
      document.getElementById('wsChip').classList.add('active');
      toast('Connected to ' + name);

      // Start streaming immediately if connected
      if (!App.navigating) {
        setInterval(() => MapRenderer.generateAndStreamFrame(), 100);
      }
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('btnRecenter').addEventListener('click', () => {
    if (App.currentPos) App.uiMap.setView([App.currentPos.lat, App.currentPos.lng], 16);
  });

  document.getElementById('panelHandle').addEventListener('click', () => {
    document.getElementById('navPanel').classList.toggle('collapsed');
  });

  document.getElementById('tftRenderWrap').addEventListener('click', () => {
    document.getElementById('tftRenderWrap').classList.toggle('minimized');
  });

  // Init TFT canvas defaults
  MapRenderer.updateTurnArrow(null);
  MapRenderer.updateDistance('--');
}

document.addEventListener('DOMContentLoaded', () => {
  initMaps();
  setupUI();
});
