/**
 * AERO-DRIVE 3D Digital Cockpit HUD — Main Application Controller
 * Powered by Mapbox GL JS v3 + Directions / Search Box / Geocoding APIs + Turf.js
 */
(function () {
  'use strict';

  const Geo = window.NaviGeometry;
  const CFG = window.APP_CONFIG;

  // =========================================================================
  // Application State
  // =========================================================================
  const state = {
    accessToken: '',
    map: null,
    mapReady: false,

    // Active driving mode: 'city' | 'highway' | 'mountain'
    mode: 'city',
    isJctZoomActive: false,
    jctBranchCoords: null,

    // Camera tracking
    followCamera: true,
    isEasingCamera: false,
    easeTimer: null,
    currentZoom: CFG.modes.city.baseZoom,
    currentPitch: CFG.modes.city.pitch,
    displayCoords: [...CFG.defaultCenter],
    displayHeading: CFG.defaultBearing,

    // Vehicle kinematic state
    vehicle: {
      coords: [...CFG.defaultCenter],
      heading: CFG.defaultBearing,
      speedMps: 0,
      altitudeM: null,
      accuracyM: null,
      routeDistKm: 0,
      isSnappedToRoute: false,
      lastSnapOffsetM: null,
    },

    // GPS & Dead Reckoning (自律航法)
    gps: {
      watchId: null,
      hasFix: false,
      lastFixTime: 0,
      lastFixCoords: null,
      lastValidSpeedMps: 0,
      lastValidHeading: CFG.defaultBearing,
      isDeadReckoning: false,
      drMode: 'OFF', // 'OFF' | 'ROUTE_SNAP' | 'VECTOR'
      drStartedAt: 0,
      drAccumulatedMeters: 0,
    },

    // Active Navigation Route (Directions API)
    routeModel: null,
    destination: null, // { name, coords }
    navProgress: null,
    activePaceNote: null,
    lastPaceHeadline: '',

    // Map markers & interactions
    egoMarker: null,
    egoMarkerEl: null,
    destMarker: null,
    pinModeActive: false,
    pendingPin: null,
    pendingPinMarker: null,

    // Simulation & Debug Controls
    sim: {
      demoMode: false,
      demoSpeedKmh: 60,
      tunnelLost: false,
      lockedTunnelSpeedMps: null,
    },

    // Screen Wake Lock
    wakeLock: {
      sentinel: null,
      enabled: true,
      supported: 'wakeLock' in navigator,
    },

    // UI state
    searchOpen: false,
    debugOpen: false,
    dashPhase: 0,
    lastFrameTs: 0,
    lastSliceUpdateTs: 0,
    toastTimer: null,
  };

  // =========================================================================
  // DOM References
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  const dom = {
    app: $('cockpit-app'),
    speedValue: $('speed-value'),
    speedArc: $('speed-arc-progress'),
    headingVal: $('heading-val'),
    altModeVal: $('alt-mode-val'),
    demoActiveChip: $('demo-active-chip'),

    gpsCard: $('gps-status-card'),
    gpsPrimary: $('gps-primary-label'),
    gpsSecondary: $('gps-secondary-label'),

    btnDestToggle: $('btn-dest-toggle'),
    destTriggerTitle: $('dest-trigger-title'),
    destTriggerMeta: $('dest-trigger-meta'),

    searchDrawer: $('search-drawer'),
    btnSearchClose: $('btn-search-close'),
    searchForm: $('search-form'),
    searchInput: $('search-input'),
    btnMapPinMode: $('btn-map-pin-mode'),
    btnClearRoute: $('btn-clear-route'),
    searchResultsSection: $('search-results-section'),
    searchResultsList: $('search-results-list'),
    presetList: $('preset-list'),

    guidanceBanner: $('guidance-banner'),
    maneuverIconBox: $('maneuver-icon-box'),
    guidanceDistance: $('guidance-distance'),
    guidanceTag: $('guidance-tag'),
    jctZoomBadge: $('jct-zoom-badge'),
    guidanceInstruction: $('guidance-instruction'),
    guidanceSub: $('guidance-sub'),

    paceNoteBanner: $('pace-note-banner'),
    paceIconBox: $('pace-icon-box'),
    paceGradePill: $('pace-grade-pill'),
    paceKicker: $('pace-kicker'),
    paceHeadline: $('pace-headline'),
    paceSubline: $('pace-subline'),
    mountainClearPill: $('mountain-clear-pill'),
    mountainStatusText: $('mountain-status-text'),

    btnWakelock: $('btn-wakelock'),
    wakelockLabel: $('wakelock-label'),
    btnRecenter: $('btn-recenter'),
    btnFullscreen: $('btn-fullscreen'),
    btnTokenSettings: $('btn-token-settings'),
    btnDebugToggle: $('btn-debug-toggle'),

    modeButtons: document.querySelectorAll('.mode-btn'),

    debugDrawer: $('debug-drawer'),
    btnDebugClose: $('btn-debug-close'),
    toggleDemoMode: $('toggle-demo-mode'),
    sliderDemoSpeed: $('slider-demo-speed'),
    demoSpeedLabel: $('demo-speed-label'),
    speedChipBtns: document.querySelectorAll('.speed-chip-btn'),
    btnDemoReset: $('btn-demo-reset'),
    toggleTunnelSim: $('toggle-tunnel-sim'),
    debugPresetList: $('debug-preset-list'),

    dbgZoom: $('dbg-zoom'),
    dbgPitch: $('dbg-pitch'),
    dbgProgress: $('dbg-progress'),
    dbgDrMode: $('dbg-dr-mode'),
    dbgBranch: $('dbg-branch'),
    dbgCurve: $('dbg-curve'),

    pinConfirmBar: $('pin-confirm-bar'),
    pinConfirmTitle: $('pin-confirm-title'),
    pinConfirmCoords: $('pin-confirm-coords'),
    btnPinRoute: $('btn-pin-route'),
    btnPinCancel: $('btn-pin-cancel'),
    hudToast: $('hud-toast'),

    tokenModalBackdrop: $('token-modal-backdrop'),
    tokenInput: $('token-input'),
    tokenErrorMsg: $('token-error-msg'),
    btnTokenSave: $('btn-token-save'),
    btnTokenCancel: $('btn-token-cancel'),
    btnTokenClear: $('btn-token-clear'),

    btnAllowPortrait: $('btn-allow-portrait'),
  };

  // =========================================================================
  // SVG Icon Library (Maneuvers & Rally Pace Notes)
  // =========================================================================
  function getManeuverSvg(key) {
    const common = 'width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
    const map = {
      straight: `<svg ${common}><path d="M12 20V5"/><path d="m7 10 5-5 5 5"/></svg>`,
      left: `<svg ${common}><path d="M16 20v-7a3 3 0 0 0-3-3H6"/><path d="m10 6-4 4 4 4"/></svg>`,
      right: `<svg ${common}><path d="M8 20v-7a3 3 0 0 1 3-3h7"/><path d="m14 6 4 4-4 4"/></svg>`,
      'slight-left': `<svg ${common}><path d="M14 20v-6l-6-7"/><path d="M8 12V7h5"/></svg>`,
      'slight-right': `<svg ${common}><path d="M10 20v-6l6-7"/><path d="M16 12V7h-5"/></svg>`,
      'sharp-left': `<svg ${common}><path d="M16 20V8l-9 7"/><path d="M7 10v5h5"/></svg>`,
      'sharp-right': `<svg ${common}><path d="M8 20V8l9 7"/><path d="M17 10v5h-5"/></svg>`,
      uturn: `<svg ${common}><path d="M16 20V9a4 4 0 0 0-8 0v6"/><path d="m5 12 3 3 3-3"/></svg>`,
      'fork-left': `<svg ${common}><path d="M12 20v-7L7 6"/><path d="M12 13l5-7" stroke-opacity="0.35"/><path d="M7 11V6h5"/></svg>`,
      'fork-right': `<svg ${common}><path d="M12 20v-7l5-7"/><path d="M12 13L7 6" stroke-opacity="0.35"/><path d="M17 11V6h-5"/></svg>`,
      'ramp-left': `<svg ${common}><path d="M15 20V5" stroke-opacity="0.32"/><path d="M15 16c0-4-4-6-8-8"/><path d="M7 13V8h5"/></svg>`,
      'ramp-right': `<svg ${common}><path d="M9 20V5" stroke-opacity="0.32"/><path d="M9 16c0-4 4-6 8-8"/><path d="M17 13V8h-5"/></svg>`,
      'merge-left': `<svg ${common}><path d="M9 20V5"/><path d="M17 19c-2-4-5-6-8-8"/><path d="m5 9 4-4 4 4"/></svg>`,
      'merge-right': `<svg ${common}><path d="M15 20V5"/><path d="M7 19c2-4 5-6 8-8"/><path d="m11 9 4-4 4 4"/></svg>`,
      roundabout: `<svg ${common}><circle cx="12" cy="11" r="4.5"/><path d="M12 20v-4.5"/><path d="M16.5 11H21"/><path d="m18 8 3 3-3 3"/></svg>`,
      arrive: `<svg ${common}><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>`,
    };
    return map[key] || map.straight;
  }

  function getPaceNoteSvg(pace) {
    const isRight = pace.direction === 'right';
    const flip = isRight ? '' : 'transform="scale(-1,1) translate(-44,0)"';
    const common = 'width="36" height="36" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"';

    if (pace.grade === 'R1') {
      // Hairpin U-bend
      return `<svg ${common}><g ${flip}>
        <path d="M13 38V16a9 9 0 0 1 18 0v14"/>
        <path d="M24 23l7 7 7-7"/>
      </g></svg>`;
    }
    if (pace.hasChicane) {
      // S-Curve
      return `<svg ${common}><g ${flip}>
        <path d="M12 38v-8c0-5 16-5 16-11V8"/>
        <path d="M22 14l6-6 6 6"/>
      </g></svg>`;
    }
    if (pace.grade === 'R2' || pace.grade === 'R3') {
      // Sharp curve
      return `<svg ${common}><g ${flip}>
        <path d="M13 38V22c0-7 5-11 13-11h7"/>
        <path d="M27 5l6 6-6 6"/>
      </g></svg>`;
    }
    // Medium curve (R4)
    return `<svg ${common}><g ${flip}>
      <path d="M15 38V25c0-6 4-11 12-15"/>
      <path d="M20 8l8 1-2 8"/>
    </g></svg>`;
  }

  // =========================================================================
  // Toast Notifications
  // =========================================================================
  function showToast(message, type = 'info', durationMs = 2800) {
    dom.hudToast.textContent = message;
    dom.hudToast.className = 'hud-toast visible';
    if (type === 'warn') dom.hudToast.classList.add('toast-warn');
    if (type === 'error') dom.hudToast.classList.add('toast-error');

    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      dom.hudToast.classList.remove('visible');
    }, durationMs);
  }

  // =========================================================================
  // Screen Wake Lock API Manager
  // =========================================================================
  async function requestWakeLock(silent = false) {
    if (!state.wakeLock.supported) {
      updateWakeLockUi(false, '非対応');
      return;
    }
    try {
      if (state.wakeLock.sentinel) {
        updateWakeLockUi(true);
        return;
      }
      const sentinel = await navigator.wakeLock.request('screen');
      state.wakeLock.sentinel = sentinel;
      state.wakeLock.enabled = true;
      sentinel.addEventListener('release', () => {
        state.wakeLock.sentinel = null;
        updateWakeLockUi(false);
      });
      updateWakeLockUi(true);
      if (!silent) showToast('Screen Wake Lock ON（画面スリープ防止）');
    } catch (_err) {
      updateWakeLockUi(false);
    }
  }

  async function releaseWakeLock() {
    state.wakeLock.enabled = false;
    if (state.wakeLock.sentinel) {
      try {
        await state.wakeLock.sentinel.release();
      } catch (_err) {
        // ignore
      }
      state.wakeLock.sentinel = null;
    }
    updateWakeLockUi(false);
    showToast('Screen Wake Lock OFF');
  }

  function updateWakeLockUi(active, fallbackText) {
    dom.btnWakelock.classList.toggle('wake-on', active);
    dom.wakelockLabel.textContent = fallbackText || (active ? 'WAKE ON' : 'WAKE');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.wakeLock.enabled) {
      requestWakeLock(true);
    }
  });

  // Re-attempt wake lock on first user interaction (mobile browser autoplay policy)
  window.addEventListener(
    'pointerdown',
    () => {
      if (state.wakeLock.enabled && !state.wakeLock.sentinel) {
        requestWakeLock(true);
      }
    },
    { once: true, passive: true }
  );

  // =========================================================================
  // Token Management & Startup Flow
  // =========================================================================
  function resolveInitialToken() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = (params.get('token') || '').trim();
    if (urlToken) {
      try {
        localStorage.setItem(CFG.tokenStorageKey, urlToken);
      } catch (_e) {}
      // Strip token from address bar for cleaner sharing
      params.delete('token');
      const cleanUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
      return urlToken;
    }

    if (typeof MAPBOX_ACCESS_TOKEN === 'string' && MAPBOX_ACCESS_TOKEN.trim()) {
      return MAPBOX_ACCESS_TOKEN.trim();
    }

    try {
      const saved = (localStorage.getItem(CFG.tokenStorageKey) || '').trim();
      if (saved) return saved;
    } catch (_e) {}

    return '';
  }

  function openTokenModal(allowCancel) {
    dom.tokenInput.value = state.accessToken || '';
    dom.tokenErrorMsg.textContent = '';
    dom.btnTokenCancel.classList.toggle('hidden', !allowCancel);
    let hasSaved = false;
    try {
      hasSaved = Boolean(localStorage.getItem(CFG.tokenStorageKey));
    } catch (_e) {}
    dom.btnTokenClear.classList.toggle('hidden', !hasSaved);
    dom.tokenModalBackdrop.classList.remove('hidden');
    setTimeout(() => dom.tokenInput.focus(), 50);
  }

  function closeTokenModal() {
    dom.tokenModalBackdrop.classList.add('hidden');
  }

  function handleSaveToken() {
    const token = dom.tokenInput.value.trim();
    if (!token || !token.startsWith('pk.')) {
      dom.tokenErrorMsg.textContent =
        '有効な Mapbox パブリックトークン（pk. で始まる文字列）を入力してください。';
      return;
    }
    try {
      localStorage.setItem(CFG.tokenStorageKey, token);
    } catch (_e) {}
    state.accessToken = token;
    closeTokenModal();

    if (state.map) {
      state.map.remove();
      state.map = null;
      state.mapReady = false;
    }
    initMapbox();
    showToast('Mapbox トークンを設定しました');
  }

  // =========================================================================
  // Mapbox GL JS v3 Initialization & 3D Autonomous Layer Stack
  // =========================================================================
  function getCockpitPadding() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const leftRail = Math.min(260, Math.max(174, w * 0.23));
    return {
      top: Math.round(h * 0.44),
      bottom: Math.round(Math.max(24, h * 0.08)),
      left: Math.round(leftRail + 14),
      right: 112,
    };
  }

  function initMapbox() {
    if (!window.mapboxgl) {
      showToast('Mapbox GL JS の読み込みに失敗しました', 'error', 5000);
      return;
    }

    mapboxgl.accessToken = state.accessToken;
    const modeCfg = CFG.modes[state.mode];

    const map = new mapboxgl.Map({
      container: 'map',
      style: CFG.mapStyle,
      center: state.vehicle.coords,
      zoom: modeCfg.baseZoom,
      pitch: modeCfg.pitch,
      bearing: state.vehicle.heading,
      maxPitch: 78,
      antialias: true,
      attributionControl: true,
    });

    state.map = map;
    state.currentZoom = modeCfg.baseZoom;
    state.currentPitch = modeCfg.pitch;

    map.on('error', (e) => {
      const status = e && e.error && e.error.status;
      if (status === 401 || status === 403) {
        showToast('Mapboxアクセストークンが無効です。KEYボタンから再設定してください。', 'error', 5000);
        openTokenModal(false);
      }
    });

    map.on('style.load', () => {
      state.mapReady = true;
      localizeLabelsToJapanese(map);
      setup3dAtmosphereAndSources(map);
      setup3dBuildingLayer(map);
      setupRouteLayers(map);
      setupEgoVehicleMarker(map);
      applyModeVisuals(state.mode, false);
      map.setPadding(getCockpitPadding());

      if (state.routeModel) {
        syncRouteSourcesToMap();
      }
    });

    // Manual camera drag/zoom pauses auto-follow until user taps Recenter
    const pauseFollowOnManualInput = (ev) => {
      if (ev && ev.originalEvent && state.followCamera) {
        setFollowCamera(false);
      }
    };
    map.on('dragstart', pauseFollowOnManualInput);
    map.on('rotatestart', pauseFollowOnManualInput);
    map.on('pitchstart', pauseFollowOnManualInput);

    // Map Long-Press & Tap Destination Selection
    bindMapDestinationGestures(map);

    window.addEventListener('resize', () => {
      if (state.map && state.mapReady) {
        state.map.setPadding(getCockpitPadding());
      }
    });
  }

  function localizeLabelsToJapanese(map) {
    try {
      const style = map.getStyle();
      if (!style || !style.layers) return;
      for (const layer of style.layers) {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
          const tf = JSON.stringify(layer.layout['text-field']);
          if (tf.includes('name_en') || tf.includes('"name"')) {
            map.setLayoutProperty(layer.id, 'text-field', [
              'coalesce',
              ['get', 'name_ja'],
              ['get', 'name'],
            ]);
          }
        }
      }
    } catch (_err) {
      // Safe no-op if a specific style layer uses non-standard expressions
    }
  }

  function setup3dAtmosphereAndSources(map) {
    // 3D Terrain DEM source (enabled in Mountain Mode)
    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }

    // Dark-tuned hillshade for dramatic 3D mountain ridges in Mountain Mode
    if (!map.getLayer('mountain-hillshade')) {
      const firstSymbol = findFirstSymbolLayerId(map);
      map.addLayer(
        {
          id: 'mountain-hillshade',
          type: 'hillshade',
          source: 'mapbox-dem',
          layout: { visibility: 'none' },
          paint: {
            'hillshade-illumination-anchor': 'map',
            'hillshade-exaggeration': 0.55,
            'hillshade-shadow-color': '#02060c',
            'hillshade-highlight-color': '#275775',
            'hillshade-accent-color': '#0d2638',
          },
        },
        firstSymbol
      );
    }

    // Empty GeoJSON sources for route & JCT beacon / interchange emphasis
    const emptyFc = { type: 'FeatureCollection', features: [] };
    if (!map.getSource('route-traveled')) {
      map.addSource('route-traveled', { type: 'geojson', data: emptyFc });
    }
    if (!map.getSource('route-remaining')) {
      map.addSource('route-remaining', { type: 'geojson', data: emptyFc, lineMetrics: true });
    }
    if (!map.getSource('route-jct-segment')) {
      map.addSource('route-jct-segment', { type: 'geojson', data: emptyFc });
    }
    if (!map.getSource('route-jct-beacon')) {
      map.addSource('route-jct-beacon', { type: 'geojson', data: emptyFc });
    }
  }

  function findFirstSymbolLayerId(map) {
    const layers = map.getStyle().layers || [];
    const found = layers.find((l) => l.type === 'symbol' && l.layout && l.layout['text-field']);
    return found ? found.id : undefined;
  }

  function setup3dBuildingLayer(map) {
    let buildingSource = 'composite';
    if (!map.getSource('composite')) {
      if (!map.getSource('streets-3d')) {
        map.addSource('streets-3d', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-streets-v8',
        });
      }
      buildingSource = 'streets-3d';
    }

    const firstSymbol = findFirstSymbolLayerId(map);

    if (!map.getLayer('3d-buildings-sensor')) {
      map.addLayer(
        {
          id: '3d-buildings-sensor',
          source: buildingSource,
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          layout: {
            visibility: 'visible',
          },
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'height'],
              0, '#0d1b2c',
              25, '#122c44',
              80, '#194764',
              180, '#22698a',
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14.5, 0,
              15.2, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14.5, 0,
              15.2, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': 0.56,
            'fill-extrusion-vertical-gradient': true,
          },
        },
        firstSymbol
      );
    }
  }

  function setupRouteLayers(map) {
    const insertBefore = map.getLayer('3d-buildings-sensor')
      ? '3d-buildings-sensor'
      : findFirstSymbolLayerId(map);

    // Traveled trail (subdued wake behind ego car)
    if (!map.getLayer('route-traveled-line')) {
      map.addLayer(
        {
          id: 'route-traveled-line',
          type: 'line',
          source: 'route-traveled',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00b4d8',
            'line-opacity': 0.25,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 7],
          },
        },
        insertBefore
      );
    }

    // Outer cyan bloom glow
    if (!map.getLayer('route-bloom-outer')) {
      map.addLayer(
        {
          id: 'route-bloom-outer',
          type: 'line',
          source: 'route-remaining',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00d4ff',
            'line-opacity': 0.28,
            'line-blur': 15,
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 14, 15, 24, 18, 36],
            'line-emissive-strength': 1,
          },
        },
        insertBefore
      );
    }

    // Mid intense cyan body
    if (!map.getLayer('route-bloom-mid')) {
      map.addLayer(
        {
          id: 'route-bloom-mid',
          type: 'line',
          source: 'route-remaining',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00e5ff',
            'line-opacity': 0.72,
            'line-blur': 4,
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 15, 13, 18, 20],
            'line-emissive-strength': 1,
          },
        },
        insertBefore
      );
    }

    // Crisp luminous white-cyan 3D core ribbon (placed above buildings for JCT clarity)
    if (!map.getLayer('route-core-ribbon')) {
      map.addLayer({
        id: 'route-core-ribbon',
        type: 'line',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#c7f9ff',
          'line-opacity': 0.96,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 5.5, 18, 8.5],
          'line-emissive-strength': 1,
        },
      });
    }

    // Autonomous energy flow dashes
    if (!map.getLayer('route-flow-dashes')) {
      map.addLayer({
        id: 'route-flow-dashes',
        type: 'line',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.55,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.2],
          'line-dasharray': [1.2, 3.8],
          'line-emissive-strength': 1,
        },
      });
    }

    // Highway JCT / IC 立体交差・分岐区間強調レイヤー (<= 1.0km 自動3Dズーム時に発光)
    if (!map.getLayer('jct-segment-glow')) {
      map.addLayer({
        id: 'jct-segment-glow',
        type: 'line',
        source: 'route-jct-segment',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#4df7ff',
          'line-opacity': 0.52,
          'line-blur': 10,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 18, 17.5, 34],
          'line-emissive-strength': 1,
        },
      });
    }
    if (!map.getLayer('jct-segment-core')) {
      map.addLayer({
        id: 'jct-segment-core',
        type: 'line',
        source: 'route-jct-segment',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.95,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 5, 17.5, 10],
          'line-emissive-strength': 1,
        },
      });
    }

    // Highway JCT / IC Branch Focus Beacon (highlighted when <= 1.0km in Highway Mode)
    if (!map.getLayer('jct-focus-ring')) {
      map.addLayer({
        id: 'jct-focus-ring',
        type: 'circle',
        source: 'route-jct-beacon',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 14, 17.5, 28],
          'circle-color': 'rgba(0, 229, 255, 0.22)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#00e5ff',
          'circle-pitch-alignment': 'map',
          'circle-emissive-strength': 1,
        },
      });
    }
    if (!map.getLayer('jct-focus-core')) {
      map.addLayer({
        id: 'jct-focus-core',
        type: 'circle',
        source: 'route-jct-beacon',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-pitch-alignment': 'map',
          'circle-emissive-strength': 1,
        },
      });
    }
  }

  function setupEgoVehicleMarker(map) {
    if (state.egoMarker) {
      state.egoMarker.remove();
    }

    const el = document.createElement('div');
    el.className = 'ego-vehicle-marker';
    el.innerHTML = `
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <defs>
          <radialGradient id="lidarConeGrad" cx="50%" cy="62%" r="55%">
            <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.72"/>
            <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <path class="ego-cone" d="M40 44 L14 4 A36 36 0 0 1 66 4 Z"/>
        <circle cx="40" cy="46" r="19" fill="none" stroke="#00e5ff" stroke-opacity="0.35" stroke-width="1.5"/>
        <path class="ego-fill" d="M40 22 L54 57 L40 50 L26 57 Z"/>
        <path d="M40 28 L40 47" stroke="#04101d" stroke-width="2.2" stroke-linecap="round" stroke-opacity="0.5"/>
      </svg>
    `;

    state.egoMarkerEl = el;
    state.egoMarker = new mapboxgl.Marker({
      element: el,
      pitchAlignment: 'map',
      rotationAlignment: 'map',
    })
      .setLngLat(state.vehicle.coords)
      .setRotation(state.vehicle.heading)
      .addTo(map);
  }

  function updateDestinationMarker(coords) {
    if (!state.map) return;
    if (state.destMarker) {
      state.destMarker.remove();
      state.destMarker = null;
    }
    if (!coords) return;

    const el = document.createElement('div');
    el.className = 'dest-pin-marker';
    el.innerHTML = '<div class="dest-pin-ring"><div class="dest-pin-core"></div></div>';

    state.destMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(coords)
      .addTo(state.map);
  }

  // =========================================================================
  // 3-Mode Visual & Camera State Machine
  // =========================================================================
  function setDrivingMode(modeId, animateCamera = true) {
    if (!CFG.modes[modeId]) return;
    state.mode = modeId;

    // Reset JCT zoom if leaving highway mode
    if (modeId !== 'highway') {
      state.isJctZoomActive = false;
      updateJctBeaconOnMap(null);
    }

    dom.modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === modeId);
    });

    applyModeVisuals(modeId, animateCamera);
    refreshGuidanceUi();
    showToast(`${CFG.modes[modeId].label}モードに切替ました`, 'info', 1800);
  }

  function applyModeVisuals(modeId, animateCamera) {
    const map = state.map;
    const modeCfg = CFG.modes[modeId];
    if (!map || !state.mapReady || !modeCfg) return;

    const showBuildings = modeId === 'city' || (modeId === 'highway' && state.isJctZoomActive);

    // 1. 3D Buildings (fill-extrusion) toggle & JCT emphasis
    if (map.getLayer('3d-buildings-sensor')) {
      map.setLayoutProperty(
        '3d-buildings-sensor',
        'visibility',
        showBuildings ? 'visible' : 'none'
      );
      map.setPaintProperty(
        '3d-buildings-sensor',
        'fill-extrusion-opacity',
        state.isJctZoomActive ? 0.68 : 0.56
      );
    }

    // 2. 3D DEM Terrain & Hillshade (Mountain Mode)
    if (modeCfg.enableTerrain) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: modeCfg.terrainExaggeration });
      if (map.getLayer('mountain-hillshade')) {
        map.setLayoutProperty('mountain-hillshade', 'visibility', 'visible');
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('mountain-hillshade')) {
        map.setLayoutProperty('mountain-hillshade', 'visibility', 'none');
      }
    }

    // 3. Atmospheric Horizon Fog
    try {
      map.setFog({
        color: modeCfg.fogHorizon,
        'high-color': modeCfg.fogHigh,
        'horizon-blend': modeId === 'mountain' ? 0.24 : 0.16,
        'space-color': '#02050a',
        'star-intensity': 0.08,
      });
    } catch (_err) {
      // Safe fallback
    }

    // 4. Smooth Camera Transition (easeTo)
    const speedKmh = state.vehicle.speedMps * 3.6;
    const targetZoom = Geo.computeSpeedAdaptiveZoom(modeId, speedKmh, state.isJctZoomActive);
    const targetPitch =
      modeId === 'highway' && state.isJctZoomActive ? CFG.modes.highway.jctPitch : modeCfg.pitch;

    if (animateCamera && state.followCamera) {
      triggerSmoothCameraEase(targetZoom, targetPitch, 1150);
    } else {
      state.currentZoom = targetZoom;
      state.currentPitch = targetPitch;
    }
  }

  function triggerSmoothCameraEase(targetZoom, targetPitch, durationMs = 1050) {
    if (!state.map || !state.mapReady) return;
    state.isEasingCamera = true;
    state.currentZoom = targetZoom;
    state.currentPitch = targetPitch;

    // Predict vehicle pose at end of easeTo so moving camera transitions land smoothly without jump
    let targetCenter = state.vehicle.coords;
    let targetBearing = state.vehicle.heading;
    const isMoving =
      (state.sim.demoMode || state.gps.isDeadReckoning) && state.vehicle.speedMps > 1;
    if (isMoving && state.routeModel && state.vehicle.isSnappedToRoute) {
      const lookaheadKm = (state.vehicle.speedMps * (durationMs / 1000)) / 1000;
      const predDistKm = Geo.clamp(state.vehicle.routeDistKm + lookaheadKm, 0, state.routeModel.totalKm);
      const predPt = turf.along(state.routeModel.line, predDistKm, { units: 'kilometers' });
      targetCenter = predPt.geometry.coordinates;
      targetBearing = Geo.getRouteHeadingAt(state.routeModel, predDistKm, 0.025);
    }

    clearTimeout(state.easeTimer);
    state.map.easeTo({
      center: targetCenter,
      bearing: targetBearing,
      zoom: targetZoom,
      pitch: targetPitch,
      duration: durationMs,
      easing: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      essential: true,
    });

    state.easeTimer = setTimeout(() => {
      state.isEasingCamera = false;
    }, durationMs + 50);
  }

  function updateJctBeaconOnMap(branchStep) {
    if (!state.map || !state.mapReady) return;
    const beaconSrc = state.map.getSource('route-jct-beacon');
    const segSrc = state.map.getSource('route-jct-segment');
    const emptyFc = { type: 'FeatureCollection', features: [] };

    if (!branchStep) {
      if (beaconSrc) beaconSrc.setData(emptyFc);
      if (segSrc) segSrc.setData(emptyFc);
      return;
    }

    const coords =
      branchStep.maneuver && Array.isArray(branchStep.maneuver.location)
        ? branchStep.maneuver.location
        : null;

    if (beaconSrc) {
      beaconSrc.setData(
        coords
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: coords },
                  properties: {},
                },
              ],
            }
          : emptyFc
      );
    }

    // Highlight ~350m interchange segment around the upcoming JCT/IC branch
    if (segSrc && state.routeModel && Number.isFinite(branchStep.routeDistKm)) {
      try {
        const s0 = Geo.clamp(branchStep.routeDistKm - 0.22, 0, state.routeModel.totalKm);
        const s1 = Geo.clamp(branchStep.routeDistKm + 0.16, s0 + 0.02, state.routeModel.totalKm);
        const slice = turf.lineSliceAlong(state.routeModel.line, s0, s1, { units: 'kilometers' });
        segSrc.setData(slice);
      } catch (_err) {
        segSrc.setData(emptyFc);
      }
    }
  }

  function setFollowCamera(enabled) {
    state.followCamera = enabled;
    dom.btnRecenter.classList.toggle('active', enabled);
    dom.btnRecenter.classList.toggle('attention', !enabled);
    if (enabled && state.map && state.mapReady) {
      const modeCfg = CFG.modes[state.mode];
      const targetZoom = Geo.computeSpeedAdaptiveZoom(
        state.mode,
        state.vehicle.speedMps * 3.6,
        state.isJctZoomActive
      );
      const targetPitch =
        state.mode === 'highway' && state.isJctZoomActive ? CFG.modes.highway.jctPitch : modeCfg.pitch;
      triggerSmoothCameraEase(targetZoom, targetPitch, 750);
    }
  }

  // =========================================================================
  // Destination Search (Search Box API + Geocoding v6 Fallback) & Long-Press
  // =========================================================================
  async function searchPlaces(query) {
    const q = query.trim();
    if (!q || !state.accessToken) return;

    dom.searchResultsSection.classList.remove('hidden');
    dom.searchResultsList.innerHTML =
      '<div class="map-hint-note">検索中...</div>';

    const [lng, lat] = state.vehicle.coords;
    let items = [];

    // Primary: Mapbox Search Box API (/forward supports POIs + Addresses in Japanese)
    try {
      const sbUrl =
        `https://api.mapbox.com/search/searchbox/v1/forward` +
        `?q=${encodeURIComponent(q)}` +
        `&language=ja&limit=5&proximity=${lng.toFixed(5)},${lat.toFixed(5)}` +
        `&access_token=${encodeURIComponent(state.accessToken)}`;
      const res = await fetch(sbUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.features) && data.features.length > 0) {
          items = data.features.map((f) => ({
            name: (f.properties && (f.properties.name || f.properties.full_address)) || q,
            address:
              (f.properties && (f.properties.full_address || f.properties.place_formatted)) || '',
            coords: f.geometry && f.geometry.coordinates,
          }));
        }
      }
    } catch (_err) {
      // Fallback below
    }

    // Fallback: Mapbox Geocoding API v6
    if (items.length === 0) {
      try {
        const geoUrl =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodeURIComponent(q)}` +
          `&language=ja&limit=5&proximity=${lng.toFixed(5)},${lat.toFixed(5)}` +
          `&access_token=${encodeURIComponent(state.accessToken)}`;
        const res = await fetch(geoUrl);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.features)) {
            items = data.features.map((f) => ({
              name: (f.properties && (f.properties.name || f.properties.full_address)) || q,
              address: (f.properties && f.properties.full_address) || '',
              coords: f.geometry && f.geometry.coordinates,
            }));
          }
        }
      } catch (_err) {
        // handled below
      }
    }

    const valid = items.filter((it) => Array.isArray(it.coords) && it.coords.length >= 2);
    if (valid.length === 0) {
      dom.searchResultsList.innerHTML =
        '<div class="map-hint-note">候補が見つかりませんでした。別のキーワードまたはマップ長押しでお試しください。</div>';
      return;
    }

    dom.searchResultsList.innerHTML = '';
    valid.forEach((place) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result-item';
      btn.innerHTML = `
        <div class="search-result-name"></div>
        <div class="search-result-addr"></div>
      `;
      btn.querySelector('.search-result-name').textContent = place.name;
      btn.querySelector('.search-result-addr').textContent = place.address || '日本';
      btn.addEventListener('click', () => {
        setDestinationAndFetchRoute(place.coords, place.name);
      });
      dom.searchResultsList.appendChild(btn);
    });
  }

  async function reverseGeocode(coords) {
    if (!state.accessToken) return `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`;
    try {
      const url =
        `https://api.mapbox.com/search/geocode/v6/reverse` +
        `?longitude=${coords[0].toFixed(6)}&latitude=${coords[1].toFixed(6)}` +
        `&language=ja&limit=1&access_token=${encodeURIComponent(state.accessToken)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const feat = data.features && data.features[0];
        if (feat && feat.properties) {
          return feat.properties.name || feat.properties.full_address || '選択した地点';
        }
      }
    } catch (_err) {
      // fallback
    }
    return `ピン指定地点 (${coords[1].toFixed(4)}, ${coords[0].toFixed(4)})`;
  }

  function bindMapDestinationGestures(map) {
    const canvas = map.getCanvasContainer();
    let pressTimer = null;
    let startPoint = null;
    let longPressed = false;

    const clearPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      startPoint = null;
    };

    const startLongPress = (clientX, clientY) => {
      clearPress();
      longPressed = false;
      startPoint = { x: clientX, y: clientY };
      pressTimer = setTimeout(async () => {
        if (!startPoint) return;
        longPressed = true;
        const rect = canvas.getBoundingClientRect();
        const lngLat = map.unproject([startPoint.x - rect.left, startPoint.y - rect.top]);
        if (navigator.vibrate) navigator.vibrate(35);
        const coords = [lngLat.lng, lngLat.lat];
        showToast('長押し地点を目的地に設定しています...');
        const placeName = await reverseGeocode(coords);
        clearPendingPin();
        await setDestinationAndFetchRoute(coords, placeName);
      }, 450);
    };

    const checkMoveCancel = (clientX, clientY) => {
      if (!startPoint) return;
      const dist = Math.hypot(clientX - startPoint.x, clientY - startPoint.y);
      if (dist > 10) clearPress();
    };

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) startLongPress(e.clientX, e.clientY);
    });
    canvas.addEventListener('mousemove', (e) => checkMoveCancel(e.clientX, e.clientY));
    canvas.addEventListener('mouseup', clearPress);

    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          startLongPress(e.touches[0].clientX, e.touches[0].clientY);
        } else {
          clearPress();
        }
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 1) {
          checkMoveCancel(e.touches[0].clientX, e.touches[0].clientY);
        } else {
          clearPress();
        }
      },
      { passive: true }
    );
    canvas.addEventListener('touchend', clearPress, { passive: true });
    canvas.addEventListener('touchcancel', clearPress, { passive: true });

    // Right-click (desktop) opens instant route confirmation
    map.on('contextmenu', async (e) => {
      const coords = [e.lngLat.lng, e.lngLat.lat];
      await openPinConfirmation(coords);
    });

    // Single tap: immediately shows pin bar when Pin Mode is ON (or when no route is active)
    map.on('click', async (e) => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      if (!state.pinModeActive && state.routeModel) return;
      const coords = [e.lngLat.lng, e.lngLat.lat];
      await openPinConfirmation(coords);
    });
  }

  async function openPinConfirmation(coords) {
    clearPendingPin();
    state.pendingPin = { coords, name: '住所を取得中...' };

    const el = document.createElement('div');
    el.className = 'dest-pin-marker';
    el.innerHTML = '<div class="dest-pin-ring"><div class="dest-pin-core"></div></div>';
    state.pendingPinMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(coords)
      .addTo(state.map);

    dom.pinConfirmTitle.textContent = '地点を確認中...';
    dom.pinConfirmCoords.textContent = `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`;
    dom.pinConfirmBar.classList.remove('hidden');

    const resolvedName = await reverseGeocode(coords);
    if (state.pendingPin && state.pendingPin.coords === coords) {
      state.pendingPin.name = resolvedName;
      dom.pinConfirmTitle.textContent = resolvedName;
    }
  }

  function clearPendingPin() {
    state.pendingPin = null;
    if (state.pendingPinMarker) {
      state.pendingPinMarker.remove();
      state.pendingPinMarker = null;
    }
    dom.pinConfirmBar.classList.add('hidden');
  }

  // =========================================================================
  // Mapbox Directions API Route Fetch & 3D Cyan Rendering
  // =========================================================================
  async function fetchDirectionsRoute(originCoords, destCoords) {
    const query =
      'geometries=geojson&steps=true&overview=full&annotations=distance,speed' +
      '&banner_instructions=true&language=ja' +
      `&access_token=${encodeURIComponent(state.accessToken)}`;
    const coordStr = `${originCoords[0].toFixed(6)},${originCoords[1].toFixed(6)};${destCoords[0].toFixed(6)},${destCoords[1].toFixed(6)}`;

    const profiles = ['mapbox/driving-traffic', 'mapbox/driving'];
    let lastError = null;

    for (const profile of profiles) {
      try {
        const url = `https://api.mapbox.com/directions/v5/${profile}/${coordStr}?${query}`;
        const res = await fetch(url);
        if (!res.ok) {
          lastError = new Error(`Directions HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        if (data && Array.isArray(data.routes) && data.routes.length > 0) {
          return data.routes[0];
        }
        lastError = new Error(data.message || 'No route found');
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('ルート取得に失敗しました');
  }

  async function setDestinationAndFetchRoute(destCoords, destName, customOrigin = null) {
    if (!state.accessToken) {
      openTokenModal(true);
      return;
    }

    const origin = customOrigin || state.vehicle.coords;
    showToast(`ルートを検索中: ${destName}`);

    try {
      const route = await fetchDirectionsRoute(origin, destCoords);
      const model = Geo.buildRouteModel(route);

      state.routeModel = model;
      state.destination = { name: destName, coords: destCoords };
      state.vehicle.coords = [...model.coords[0]];
      state.vehicle.routeDistKm = 0;
      state.vehicle.isSnappedToRoute = true;
      state.vehicle.heading = Geo.getRouteHeadingAt(model, 0, 0.03);
      state.gps.lastValidHeading = state.vehicle.heading;
      state.displayCoords = [...state.vehicle.coords];
      state.displayHeading = state.vehicle.heading;
      state.isJctZoomActive = false;
      state.activePaceNote = null;
      state.lastPaceHeadline = '';

      updateDestinationMarker(destCoords);
      syncRouteSourcesToMap();
      setPinMode(false);
      clearPendingPin();
      setSearchDrawerOpen(false);
      dom.btnClearRoute.classList.remove('hidden');

      updateNavigationAnalytics();
      setFollowCamera(true);

      showToast(
        `ルート設定完了：${Geo.formatDistanceJa(model.totalMeters)}（約${Geo.formatDurationJa(model.totalDurationSec)}）`,
        'info',
        3200
      );
    } catch (err) {
      showToast(`ルート取得エラー: ${err.message}`, 'error', 4000);
    }
  }

  function clearActiveRoute() {
    state.routeModel = null;
    state.destination = null;
    state.navProgress = null;
    state.activePaceNote = null;
    state.vehicle.routeDistKm = 0;
    state.vehicle.isSnappedToRoute = false;
    state.isJctZoomActive = false;

    if (state.sim.demoMode) {
      state.sim.demoMode = false;
      dom.toggleDemoMode.checked = false;
      dom.demoActiveChip.classList.add('hidden');
    }

    updateDestinationMarker(null);
    updateJctBeaconOnMap(null);
    syncRouteSourcesToMap();
    applyModeVisuals(state.mode, true);
    refreshGuidanceUi();
    dom.btnClearRoute.classList.add('hidden');
    dom.destTriggerTitle.textContent = '目的地を検索 / タップ設定';
    dom.destTriggerMeta.textContent = 'ルート未設定 · 長押し対応';
    showToast('ルート案内を終了しました');
  }

  function syncRouteSourcesToMap() {
    if (!state.map || !state.mapReady) return;
    const emptyFc = { type: 'FeatureCollection', features: [] };
    const srcTraveled = state.map.getSource('route-traveled');
    const srcRemaining = state.map.getSource('route-remaining');
    if (!srcTraveled || !srcRemaining) return;

    if (!state.routeModel) {
      srcTraveled.setData(emptyFc);
      srcRemaining.setData(emptyFc);
      return;
    }

    const sliced = Geo.sliceRouteProgress(state.routeModel, state.vehicle.routeDistKm);
    srcTraveled.setData(sliced.traveled);
    srcRemaining.setData(sliced.remaining);
  }

  async function loadDemoPreset(preset, autoStartDemo = true) {
    if (!state.accessToken) {
      openTokenModal(true);
      return;
    }
    setDrivingMode(preset.mode, false);
    state.sim.demoSpeedKmh = preset.defaultSpeedKmh;
    dom.sliderDemoSpeed.value = String(preset.defaultSpeedKmh);
    dom.demoSpeedLabel.textContent = `${preset.defaultSpeedKmh} km/h`;

    await setDestinationAndFetchRoute(preset.destination, preset.name, preset.origin);

    if (autoStartDemo && state.routeModel) {
      state.sim.demoMode = true;
      dom.toggleDemoMode.checked = true;
      dom.demoActiveChip.classList.remove('hidden');
      state.vehicle.speedMps = preset.defaultSpeedKmh / 3.6;
      state.gps.lastValidSpeedMps = state.vehicle.speedMps;
      applyModeVisuals(preset.mode, true);
      showToast(`${preset.badge}デモ走行を開始 (${preset.defaultSpeedKmh} km/h)`);
    }
  }

  // =========================================================================
  // Geolocation API & Route-Snapped Dead Reckoning (自律航法)
  // =========================================================================
  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      updateGpsStatusUi();
      return;
    }

    state.gps.watchId = navigator.geolocation.watchPosition(
      onGpsPosition,
      onGpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 5000,
      }
    );
  }

  function onGpsPosition(pos) {
    // Ignore live GPS updates while Demo Driving or Tunnel Simulation is active
    if (state.sim.demoMode || state.sim.tunnelLost) return;

    const { longitude, latitude, heading, speed, accuracy, altitude } = pos.coords;
    const now = Date.now();

    // Severe accuracy drop indicates tunnel / underground / deep urban occlusion
    if (Number.isFinite(accuracy) && accuracy > CFG.gps.poorAccuracyMeters && state.gps.hasFix) {
      enterDeadReckoning('精度低下');
      return;
    }

    const newCoords = [longitude, latitude];
    const dtSec = state.gps.lastFixTime > 0 ? (now - state.gps.lastFixTime) / 1000 : 0;

    let computedSpeedMps = Number.isFinite(speed) && speed >= 0 ? speed : null;
    let computedHeading = Number.isFinite(heading) ? heading : null;

    if (state.gps.lastFixCoords && dtSec > 0.15 && dtSec < 10) {
      const movedKm = turf.distance(turf.point(state.gps.lastFixCoords), turf.point(newCoords), {
        units: 'kilometers',
      });
      const movedM = movedKm * 1000;
      if (computedSpeedMps === null) {
        computedSpeedMps = movedM / dtSec;
      }
      if (computedHeading === null && movedM > 2.5 && (computedSpeedMps || 0) >= CFG.gps.minHeadingSpeedMps) {
        computedHeading = Geo.normalizeBearing(
          turf.bearing(turf.point(state.gps.lastFixCoords), turf.point(newCoords))
        );
      }
    }

    const wasFirstFix = !state.gps.hasFix;
    state.gps.hasFix = true;
    state.gps.lastFixTime = now;
    state.gps.lastFixCoords = newCoords;

    // Exit Dead Reckoning cleanly on signal recovery
    if (state.gps.isDeadReckoning) {
      exitDeadReckoning();
      showToast('GPS信号を再捕捉しました（GPS ONLINE）');
    }

    state.vehicle.accuracyM = Number.isFinite(accuracy) ? Math.round(accuracy) : null;
    if (Number.isFinite(altitude)) {
      state.vehicle.altitudeM = Math.round(altitude);
    }

    const finalSpeedMps = computedSpeedMps !== null ? computedSpeedMps : 0;
    state.vehicle.speedMps = finalSpeedMps;
    if (finalSpeedMps > 0.5) {
      state.gps.lastValidSpeedMps = finalSpeedMps;
    }

    // Snap onto route if active
    if (state.routeModel) {
      const snap = Geo.snapToRoute(
        state.routeModel,
        newCoords,
        state.vehicle.isSnappedToRoute ? state.vehicle.routeDistKm : null,
        CFG.gps.routeSnapThresholdM
      );
      if (snap && snap.isOnRoute) {
        state.vehicle.coords = snap.snappedCoords;
        state.vehicle.routeDistKm = snap.distAlongKm;
        state.vehicle.isSnappedToRoute = true;
        state.vehicle.lastSnapOffsetM = Math.round(snap.offsetMeters);
        state.vehicle.heading =
          computedHeading !== null ? computedHeading : snap.routeHeading;
      } else {
        state.vehicle.coords = newCoords;
        state.vehicle.isSnappedToRoute = false;
        state.vehicle.lastSnapOffsetM = snap ? Math.round(snap.offsetMeters) : null;
        if (computedHeading !== null) state.vehicle.heading = computedHeading;
      }
    } else {
      state.vehicle.coords = newCoords;
      if (computedHeading !== null) state.vehicle.heading = computedHeading;
    }

    if (wasFirstFix) {
      state.displayCoords = [...state.vehicle.coords];
      state.displayHeading = state.vehicle.heading;
    }

    state.gps.lastValidHeading = state.vehicle.heading;

    // Auto-collapse search drawer when vehicle starts moving
    if (finalSpeedMps * 3.6 >= 10 && state.searchOpen) {
      setSearchDrawerOpen(false);
    }

    updateNavigationAnalytics();
    updateGpsStatusUi();
  }

  function onGpsError(_err) {
    if (state.sim.demoMode || state.sim.tunnelLost) return;
    if (state.gps.hasFix) {
      enterDeadReckoning('信号途絶');
    } else {
      updateGpsStatusUi();
    }
  }

  function enterDeadReckoning(reason = 'GPSロスト') {
    if (state.gps.isDeadReckoning) return;
    state.gps.isDeadReckoning = true;
    state.gps.drStartedAt = Date.now();
    state.gps.drAccumulatedMeters = 0;

    // Lock the speed entering the tunnel (using last valid speed, or demo slider if testing indoors)
    const activeSpeedMps =
      state.sim.demoMode
        ? state.sim.demoSpeedKmh / 3.6
        : state.gps.lastValidSpeedMps > 0.5
        ? state.gps.lastValidSpeedMps
        : state.sim.tunnelLost
        ? state.sim.demoSpeedKmh / 3.6
        : 0;
    state.sim.lockedTunnelSpeedMps = activeSpeedMps;
    state.vehicle.speedMps = activeSpeedMps;

    dom.app.classList.add('state-dead-reckoning');
    if (state.egoMarkerEl) state.egoMarkerEl.classList.add('is-dr');
    updateGpsStatusUi();
    showToast(`自律航法（Dead Reckoning）へ切替：${reason}`, 'warn', 3200);
  }

  function exitDeadReckoning() {
    if (!state.gps.isDeadReckoning) return;
    state.gps.isDeadReckoning = false;
    state.gps.drMode = 'OFF';
    state.sim.lockedTunnelSpeedMps = null;
    dom.app.classList.remove('state-dead-reckoning');
    if (state.egoMarkerEl) state.egoMarkerEl.classList.remove('is-dr');
    updateGpsStatusUi();
  }

  // Watchdog checks GPS freshness every 250ms
  setInterval(() => {
    if (state.sim.tunnelLost) {
      if (!state.gps.isDeadReckoning) enterDeadReckoning('トンネル進入シミュレーション');
      return;
    }
    if (state.sim.demoMode) {
      if (state.gps.isDeadReckoning) exitDeadReckoning();
      return;
    }
    if (state.gps.hasFix && !state.gps.isDeadReckoning) {
      const elapsed = Date.now() - state.gps.lastFixTime;
      if (elapsed > CFG.gps.signalTimeoutMs) {
        enterDeadReckoning('トンネル / 信号途絶');
      }
    }
  }, 250);

  // =========================================================================
  // Core 60fps Simulation, Dead Reckoning, Camera & Telemetry Loop
  // =========================================================================
  function tickAnimationLoop(ts) {
    if (!state.lastFrameTs) state.lastFrameTs = ts;
    const dtSec = Math.min(0.15, Math.max(0.001, (ts - state.lastFrameTs) / 1000));
    state.lastFrameTs = ts;

    // 1. Kinematic step (Dead Reckoning OR Virtual Demo Drive)
    if (state.gps.isDeadReckoning) {
      // Allow speed adjustment via simulator slider during tunnel testing
      const drSpeedMps = state.sim.tunnelLost
        ? state.sim.demoSpeedKmh / 3.6
        : state.sim.lockedTunnelSpeedMps !== null
        ? state.sim.lockedTunnelSpeedMps
        : state.gps.lastValidSpeedMps;

      state.vehicle.speedMps = drSpeedMps;

      const step = Geo.advanceDeadReckoning(
        {
          coords: state.vehicle.coords,
          heading: state.vehicle.heading,
          speedMps: drSpeedMps,
          routeDistKm: state.vehicle.routeDistKm,
          isSnappedToRoute: Boolean(state.routeModel && state.vehicle.isSnappedToRoute),
        },
        state.routeModel,
        dtSec
      );

      state.vehicle.coords = step.coords;
      state.vehicle.heading = step.heading;
      state.vehicle.routeDistKm = step.routeDistKm;
      state.gps.drMode = step.mode;
      state.gps.drAccumulatedMeters += step.movedMeters;
      state.gps.lastValidHeading = step.heading;

      updateNavigationAnalytics();
      if (ts - state.lastSliceUpdateTs > 140) {
        syncRouteSourcesToMap();
        state.lastSliceUpdateTs = ts;
      }
    } else if (state.sim.demoMode && state.routeModel) {
      const demoSpeedMps = state.sim.demoSpeedKmh / 3.6;
      state.vehicle.speedMps = demoSpeedMps;
      state.gps.lastValidSpeedMps = demoSpeedMps;

      const step = Geo.advanceDeadReckoning(
        {
          coords: state.vehicle.coords,
          heading: state.vehicle.heading,
          speedMps: demoSpeedMps,
          routeDistKm: state.vehicle.routeDistKm,
          isSnappedToRoute: true,
        },
        state.routeModel,
        dtSec
      );

      state.vehicle.coords = step.coords;
      state.vehicle.heading = step.heading;
      state.vehicle.routeDistKm = step.routeDistKm;
      state.vehicle.isSnappedToRoute = true;
      state.gps.lastValidHeading = step.heading;

      if (step.reachedEnd) {
        state.sim.demoMode = false;
        dom.toggleDemoMode.checked = false;
        dom.demoActiveChip.classList.add('hidden');
        state.vehicle.speedMps = 0;
        showToast('目的地に到着しました（デモ走行完了）', 'info', 3500);
      }

      updateNavigationAnalytics();
      if (ts - state.lastSliceUpdateTs > 140) {
        syncRouteSourcesToMap();
        state.lastSliceUpdateTs = ts;
      }
    }

    // 2. Smooth display interpolation & 3D Mapbox Camera update
    const smoothFactor = Math.min(1, dtSec * 10);
    state.displayCoords[0] += (state.vehicle.coords[0] - state.displayCoords[0]) * smoothFactor;
    state.displayCoords[1] += (state.vehicle.coords[1] - state.displayCoords[1]) * smoothFactor;
    state.displayHeading = Geo.lerpBearing(state.displayHeading, state.vehicle.heading, smoothFactor);

    if (state.map && state.mapReady) {
      // Update ego vehicle marker pose
      if (state.egoMarker) {
        state.egoMarker.setLngLat(state.displayCoords);
        state.egoMarker.setRotation(state.displayHeading);
      }

      // Query real 3D DEM terrain elevation when in Mountain Mode
      if (state.mode === 'mountain' && typeof state.map.queryTerrainElevation === 'function') {
        const elev = state.map.queryTerrainElevation(state.displayCoords, { exaggerated: false });
        if (Number.isFinite(elev)) {
          state.vehicle.altitudeM = Math.round(elev);
        }
      }

      // Speed-adaptive camera zoom & heading-up tracking (when not mid easeTo transition)
      if (state.followCamera && !state.isEasingCamera) {
        const speedKmh = state.vehicle.speedMps * 3.6;
        const desiredZoom = Geo.computeSpeedAdaptiveZoom(
          state.mode,
          speedKmh,
          state.isJctZoomActive
        );
        const modeCfg = CFG.modes[state.mode];
        const desiredPitch =
          state.mode === 'highway' && state.isJctZoomActive
            ? CFG.modes.highway.jctPitch
            : modeCfg.pitch;

        // Smooth damping so highway speed-zoom changes feel liquid-smooth
        const zoomLerp = Math.min(1, dtSec * 2.4);
        state.currentZoom += (desiredZoom - state.currentZoom) * zoomLerp;
        state.currentPitch += (desiredPitch - state.currentPitch) * zoomLerp;

        state.map.jumpTo({
          center: state.displayCoords,
          bearing: state.displayHeading,
          zoom: state.currentZoom,
          pitch: state.currentPitch,
        });
      }

      // Subtle glowing pulse on remaining route
      if (state.routeModel && state.map.getLayer('route-bloom-outer')) {
        state.dashPhase = (state.dashPhase + dtSec * 2.2) % (Math.PI * 2);
        const pulse = 0.24 + 0.08 * Math.sin(state.dashPhase);
        state.map.setPaintProperty('route-bloom-outer', 'line-opacity', pulse);
      }
    }

    // 3. Update Instrument Cluster & Live Debug Readouts
    renderSpeedometerAndTelemetry();
    if (state.gps.isDeadReckoning) {
      updateGpsStatusUi();
    }

    requestAnimationFrame(tickAnimationLoop);
  }

  // =========================================================================
  // Navigation Analytics (City Steps / Highway JCT Auto-Zoom / Mountain Pace Notes)
  // =========================================================================
  function updateNavigationAnalytics() {
    if (!state.routeModel) {
      state.navProgress = null;
      state.activePaceNote = null;
      refreshGuidanceUi();
      return;
    }

    const progress = Geo.getNavigationProgress(state.routeModel, state.vehicle.routeDistKm);
    state.navProgress = progress;

    // Highway Mode: evaluate <= 1.0km IC/JCT auto 3D zoom transition
    if (state.mode === 'highway') {
      const jctEval = Geo.evaluateHighwayJctZoom(
        progress,
        state.isJctZoomActive,
        CFG.modes.highway
      );

      if (jctEval.active !== state.isJctZoomActive) {
        state.isJctZoomActive = jctEval.active;
        updateJctBeaconOnMap(jctEval.active ? jctEval.branch : null);
        applyModeVisuals('highway', true);

        if (jctEval.active) {
          showToast(
            `分岐 ${Geo.formatDistanceJa(jctEval.distMeters)}先 — 3D近接ズーム起動`,
            'info',
            2600
          );
        } else {
          showToast('分岐通過 — 高速広域クルーズ視点へ復帰', 'info', 2200);
        }
      }
    }

    // Mountain Mode: real-route curvature pace note analysis (100m–300m ahead)
    if (state.mode === 'mountain') {
      const pace = Geo.analyzeMountainPaceNote(state.routeModel, state.vehicle.routeDistKm, {
        lookaheadMinMeters: CFG.modes.mountain.lookaheadMinMeters,
        lookaheadMaxMeters: CFG.modes.mountain.lookaheadMaxMeters,
      });
      state.activePaceNote = pace;
    } else {
      state.activePaceNote = null;
    }

    refreshGuidanceUi();
  }

  // =========================================================================
  // HUD Rendering Updates
  // =========================================================================
  function renderSpeedometerAndTelemetry() {
    const speedKmh = Math.max(0, Math.round(state.vehicle.speedMps * 3.6));
    dom.speedValue.textContent = String(speedKmh);

    // 240° arc length = 326.73 (0–160 km/h full sweep)
    const ratio = Geo.clamp(speedKmh / 160, 0, 1);
    const dashOffset = 326.73 * (1 - ratio);
    dom.speedArc.style.strokeDashoffset = dashOffset.toFixed(2);

    const hdg = Math.round(Geo.normalizeBearing(state.displayHeading))
      .toString()
      .padStart(3, '0');
    dom.headingVal.textContent = `${hdg}° ${Geo.bearingToCompass(state.displayHeading)}`;

    const modeCode = CFG.modes[state.mode].code;
    const altStr = state.vehicle.altitudeM !== null ? `${state.vehicle.altitudeM}m` : '--m';
    dom.altModeVal.textContent = `${modeCode} · ${altStr}`;

    // Destination pill summary
    if (state.destination && state.navProgress) {
      dom.destTriggerTitle.textContent = state.destination.name;
      dom.destTriggerMeta.textContent = `残り ${Geo.formatDistanceJa(state.navProgress.remainingMeters)} · 約${Geo.formatDurationJa(state.navProgress.remainingSeconds)}`;
    }

    // Debug panel live telemetry
    if (state.debugOpen) {
      dom.dbgZoom.textContent = state.map ? state.map.getZoom().toFixed(2) : '--';
      dom.dbgPitch.textContent = state.map ? `${Math.round(state.map.getPitch())}°` : '--';
      dom.dbgProgress.textContent = state.navProgress
        ? `${Math.round(state.navProgress.progressRatio * 100)}%`
        : '--';
      dom.dbgDrMode.textContent = state.gps.isDeadReckoning ? state.gps.drMode : 'OFF';
      dom.dbgBranch.textContent =
        state.navProgress && state.navProgress.nextBranch
          ? Geo.formatDistanceJa(state.navProgress.distToBranchMeters)
          : '--';
      dom.dbgCurve.textContent = state.activePaceNote
        ? `${state.activePaceNote.grade} (${state.activePaceNote.absTurnDeg}°)`
        : 'CLEAR';
    }
  }

  function updateGpsStatusUi() {
    dom.gpsCard.classList.remove('status-online', 'status-dr', 'status-acquiring');

    if (state.gps.isDeadReckoning) {
      dom.gpsCard.classList.add('status-dr');
      const sec = Math.max(0, Math.round((Date.now() - state.gps.drStartedAt) / 1000));
      const distStr = Geo.formatDistanceJa(state.gps.drAccumulatedMeters);
      const snapTag = state.gps.drMode === 'ROUTE_SNAP' ? 'ルートスナップ' : '直進ベクトル';
      dom.gpsPrimary.textContent = 'DEAD RECKONING';
      dom.gpsSecondary.textContent = `自律航法中 · ${snapTag} · ${distStr} (${sec}s)`;
      return;
    }

    if (state.sim.demoMode) {
      dom.gpsCard.classList.add('status-online');
      dom.gpsPrimary.textContent = 'GPS ONLINE (SIM)';
      dom.gpsSecondary.textContent = `仮想走行モード · ${state.sim.demoSpeedKmh} km/h`;
      return;
    }

    if (state.gps.hasFix) {
      dom.gpsCard.classList.add('status-online');
      const acc = state.vehicle.accuracyM !== null ? `±${state.vehicle.accuracyM}m` : '高精度';
      const snap = state.vehicle.isSnappedToRoute ? ' · ルートロック' : '';
      dom.gpsPrimary.textContent = 'GPS ONLINE';
      dom.gpsSecondary.textContent = `精度 ${acc}${snap}`;
      return;
    }

    dom.gpsCard.classList.add('status-acquiring');
    dom.gpsPrimary.textContent = 'GPS STANDBY';
    dom.gpsSecondary.textContent = '位置情報待機 / SIMで室内テスト可';
  }

  function refreshGuidanceUi() {
    const mode = state.mode;
    const nav = state.navProgress;

    // Reset all top banners first
    dom.guidanceBanner.classList.add('hidden');
    dom.paceNoteBanner.classList.add('hidden');
    dom.mountainClearPill.classList.add('hidden');

    // --- Mountain Mode HUD ---
    if (mode === 'mountain') {
      if (state.activePaceNote) {
        const p = state.activePaceNote;
        dom.paceNoteBanner.className = `hud-panel pace-note-banner grade-${p.grade}`;
        if (p.headline !== state.lastPaceHeadline) {
          dom.paceNoteBanner.classList.add('pace-pop');
          state.lastPaceHeadline = p.headline;
        }
        dom.paceIconBox.innerHTML = getPaceNoteSvg(p);
        dom.paceGradePill.textContent = p.grade;
        dom.paceKicker.textContent = p.hasChicane
          ? 'RALLY PACE NOTE · 連続S字注意'
          : 'RALLY PACE NOTE · 前方曲率解析';
        dom.paceHeadline.textContent = p.headline;
        dom.paceSubline.textContent = p.subline;
      } else {
        state.lastPaceHeadline = '';
        dom.mountainClearPill.classList.remove('hidden');
        dom.mountainStatusText.textContent = state.routeModel
          ? '前方300m クリア（急カーブなし）'
          : 'ルート設定で実ルート曲率ペースノート稼働';
      }
      return;
    }

    // --- City Mode & Highway Mode HUD ---
    if (!nav) {
      dom.guidanceBanner.className = `hud-panel guidance-banner ${mode === 'highway' ? 'mode-highway' : ''}`;
      dom.maneuverIconBox.innerHTML = getManeuverSvg('straight');
      dom.guidanceDistance.textContent = mode === 'highway' ? 'HWY' : 'READY';
      dom.guidanceTag.textContent = mode === 'highway' ? 'IC / JCT MONITOR' : 'CITY 3D SENSOR';
      dom.jctZoomBadge.classList.add('hidden');
      dom.guidanceInstruction.textContent = '目的地を設定して3Dルート案内を開始';
      dom.guidanceSub.textContent = '左下の検索、またはマップ長押しで目的地を指定できます';
      return;
    }

    if (mode === 'highway') {
      const branch = nav.nextBranch;
      const distStr = Geo.formatDistanceJa(nav.distToBranchMeters);

      dom.guidanceBanner.className = `hud-panel guidance-banner mode-highway ${
        state.isJctZoomActive ? 'jct-zoom-active' : ''
      }`;
      dom.maneuverIconBox.innerHTML = getManeuverSvg(branch.maneuverKey);
      dom.guidanceDistance.textContent = distStr;
      dom.guidanceTag.textContent = nav.isFallbackBranch ? 'NEXT POINT' : branch.branchTag;
      dom.jctZoomBadge.classList.toggle('hidden', !state.isJctZoomActive);
      dom.guidanceInstruction.textContent = branch.title || branch.instruction;
      dom.guidanceSub.textContent = state.isJctZoomActive
        ? `1.0km以内接近 · 3D近距離立体ビュー自動切替中（${branch.instruction}）`
        : `${branch.instruction}`;
    } else {
      // City Mode Turn-by-Turn
      const step = nav.nextStep;
      const distStr = Geo.formatDistanceJa(nav.distToStepMeters);

      dom.guidanceBanner.className = 'hud-panel guidance-banner';
      dom.maneuverIconBox.innerHTML = getManeuverSvg(step.maneuverKey);
      dom.guidanceDistance.textContent = distStr;
      dom.guidanceTag.textContent = step.maneuver.type === 'arrive' ? 'ARRIVAL' : 'NEXT TURN';
      dom.jctZoomBadge.classList.add('hidden');
      dom.guidanceInstruction.textContent = step.instruction || step.title;
      dom.guidanceSub.textContent = nav.followingStep
        ? `その先：${nav.followingStep.title}（${Geo.formatDistanceJa(step.distance)}）`
        : `目的地まで残り ${Geo.formatDistanceJa(nav.remainingMeters)}`;
    }
  }

  // =========================================================================
  // UI Drawers, Presets & Event Bindings
  // =========================================================================
  function setSearchDrawerOpen(open) {
    state.searchOpen = open;
    dom.searchDrawer.classList.toggle('collapsed', !open);
    dom.btnDestToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      setDebugDrawerOpen(false);
    }
  }

  function setDebugDrawerOpen(open) {
    state.debugOpen = open;
    dom.debugDrawer.classList.toggle('collapsed', !open);
    dom.btnDebugToggle.classList.toggle('active', open);
    if (open) {
      setSearchDrawerOpen(false);
    }
  }

  function setPinMode(active) {
    state.pinModeActive = active;
    dom.btnMapPinMode.classList.toggle('active', active);
    if (state.map) {
      state.map.getCanvas().style.cursor = active ? 'crosshair' : '';
    }
    if (active) {
      setSearchDrawerOpen(false);
      showToast('マップをタップして目的地を選択してください');
    }
  }

  function renderPresetButtons(container, autoStartDemo) {
    container.innerHTML = '';
    CFG.demoPresets.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-card';
      btn.innerHTML = `
        <div>
          <div class="preset-name"></div>
          <div class="preset-desc"></div>
        </div>
        <span class="preset-badge"></span>
      `;
      btn.querySelector('.preset-name').textContent = preset.name;
      btn.querySelector('.preset-desc').textContent = preset.desc;
      btn.querySelector('.preset-badge').textContent = preset.badge;
      btn.addEventListener('click', () => loadDemoPreset(preset, autoStartDemo));
      container.appendChild(btn);
    });
  }

  async function toggleFullscreenLandscape() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape').catch(() => {});
        }
        dom.btnFullscreen.classList.add('active');
      } else {
        await document.exitFullscreen();
        dom.btnFullscreen.classList.remove('active');
      }
    } catch (_err) {
      showToast('フルスクリーン切替がこのブラウザで制限されています', 'warn');
    }
  }

  function bindUiEvents() {
    // Mode Switcher Buttons
    dom.modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        setDrivingMode(btn.dataset.mode, true);
      });
    });

    // Destination Search Drawer
    dom.btnDestToggle.addEventListener('click', () => setSearchDrawerOpen(!state.searchOpen));
    dom.btnSearchClose.addEventListener('click', () => setSearchDrawerOpen(false));
    dom.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchPlaces(dom.searchInput.value);
    });
    dom.btnMapPinMode.addEventListener('click', () => setPinMode(!state.pinModeActive));
    dom.btnClearRoute.addEventListener('click', clearActiveRoute);

    // Map Pin Confirmation Bar
    dom.btnPinRoute.addEventListener('click', () => {
      if (state.pendingPin) {
        setDestinationAndFetchRoute(state.pendingPin.coords, state.pendingPin.name);
      }
    });
    dom.btnPinCancel.addEventListener('click', clearPendingPin);

    // Utility Bar
    dom.btnWakelock.addEventListener('click', () => {
      if (state.wakeLock.sentinel) {
        releaseWakeLock();
      } else {
        requestWakeLock(false);
      }
    });
    dom.btnRecenter.addEventListener('click', () => setFollowCamera(true));
    dom.btnFullscreen.addEventListener('click', toggleFullscreenLandscape);
    dom.btnTokenSettings.addEventListener('click', () => openTokenModal(Boolean(state.accessToken)));
    dom.btnDebugToggle.addEventListener('click', () => setDebugDrawerOpen(!state.debugOpen));
    dom.btnDebugClose.addEventListener('click', () => setDebugDrawerOpen(false));

    // Debug & Simulation Controls
    dom.toggleDemoMode.addEventListener('change', async () => {
      const enabled = dom.toggleDemoMode.checked;
      if (enabled && !state.routeModel) {
        // Automatically load matching mode's demo preset if no route is set yet
        const match =
          CFG.demoPresets.find((p) => p.mode === state.mode) || CFG.demoPresets[0];
        showToast('デモ用ルートを自動取得しています...');
        await loadDemoPreset(match, true);
        return;
      }

      state.sim.demoMode = enabled;
      dom.demoActiveChip.classList.toggle('hidden', !enabled);
      if (enabled) {
        state.vehicle.speedMps = state.sim.demoSpeedKmh / 3.6;
        state.gps.lastValidSpeedMps = state.vehicle.speedMps;
        setFollowCamera(true);
        setSearchDrawerOpen(false);
        showToast(`デモ走行 ON（${state.sim.demoSpeedKmh} km/h）`);
      } else {
        state.vehicle.speedMps = 0;
        showToast('デモ走行 OFF');
      }
      updateGpsStatusUi();
    });

    const applyDemoSpeed = (val) => {
      const kmh = Geo.clamp(Number(val) || 0, 0, 150);
      state.sim.demoSpeedKmh = kmh;
      dom.sliderDemoSpeed.value = String(kmh);
      dom.demoSpeedLabel.textContent = `${kmh} km/h`;
      if (state.sim.demoMode || state.sim.tunnelLost) {
        state.vehicle.speedMps = kmh / 3.6;
        state.gps.lastValidSpeedMps = kmh / 3.6;
      }
    };

    dom.sliderDemoSpeed.addEventListener('input', (e) => applyDemoSpeed(e.target.value));
    dom.speedChipBtns.forEach((btn) => {
      btn.addEventListener('click', () => applyDemoSpeed(btn.dataset.speed));
    });

    dom.btnDemoReset.addEventListener('click', () => {
      if (!state.routeModel) {
        showToast('先にルートを設定してください', 'warn');
        return;
      }
      state.vehicle.routeDistKm = 0;
      state.vehicle.coords = [...state.routeModel.coords[0]];
      state.vehicle.heading = Geo.getRouteHeadingAt(state.routeModel, 0, 0.03);
      state.vehicle.isSnappedToRoute = true;
      state.displayCoords = [...state.vehicle.coords];
      state.displayHeading = state.vehicle.heading;
      state.isJctZoomActive = false;
      updateJctBeaconOnMap(null);
      syncRouteSourcesToMap();
      updateNavigationAnalytics();
      setFollowCamera(true);
      showToast('スタート地点へ戻しました');
    });

    // Tunnel / GPS Lost Simulation Toggle
    dom.toggleTunnelSim.addEventListener('change', () => {
      const lost = dom.toggleTunnelSim.checked;
      state.sim.tunnelLost = lost;
      if (lost) {
        // Ensure non-zero movement speed for indoor demonstration if currently 0
        if (state.sim.demoSpeedKmh === 0 && state.gps.lastValidSpeedMps < 0.5) {
          applyDemoSpeed(70);
        }
        enterDeadReckoning('トンネル進入シミュレーション');
      } else {
        exitDeadReckoning();
        showToast('トンネル脱出 — GPSオンライン復帰');
      }
    });

    // Token Modal Actions
    dom.btnTokenSave.addEventListener('click', handleSaveToken);
    dom.tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSaveToken();
    });
    dom.btnTokenCancel.addEventListener('click', closeTokenModal);
    dom.btnTokenClear.addEventListener('click', () => {
      try {
        localStorage.removeItem(CFG.tokenStorageKey);
      } catch (_e) {}
      dom.tokenInput.value = '';
      dom.btnTokenClear.classList.add('hidden');
      showToast('保存済みトークンを削除しました');
    });

    // Portrait Advisory Dismiss
    dom.btnAllowPortrait.addEventListener('click', () => {
      document.body.classList.add('allow-portrait');
    });
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================
  function init() {
    renderPresetButtons(dom.presetList, true);
    renderPresetButtons(dom.debugPresetList, true);
    bindUiEvents();
    updateGpsStatusUi();
    refreshGuidanceUi();

    // Start Wake Lock & Geolocation Watcher
    requestWakeLock(true);
    startGeolocation();

    // Start 60fps HUD & Kinematic Animation Loop
    requestAnimationFrame(tickAnimationLoop);

    // Resolve Mapbox Access Token & Mount 3D Map
    state.accessToken = resolveInitialToken();
    if (state.accessToken) {
      initMapbox();
    } else {
      openTokenModal(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
