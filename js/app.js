/**
 * AERO-DRIVE 3D Digital Cockpit — Main Application Controller
 * Powered by Mapbox GL JS v3 (Standard Style) + Directions / Search Box / Geocoding APIs + Turf.js
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

    // Auto / Forced Close-Range 3D Zoom state (City <=150m, Highway <=800m)
    autoCloseZoomActive: false,
    isCloseZoomActive: false,
    closeZoomStep: null,
    lastManeuverDirectDistM: Infinity,

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
      forceCloseZoom: false,
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
    speedBarFill: $('speed-bar-fill'),
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
    btnForceCloseZoom: $('btn-force-close-zoom'),
    forceCloseZoomLabel: $('force-close-zoom-label'),
    toggleTunnelSim: $('toggle-tunnel-sim'),
    debugPresetList: $('debug-preset-list'),

    dbgZoom: $('dbg-zoom'),
    dbgPitch: $('dbg-pitch'),
    dbgAutoZoom: $('dbg-auto-zoom'),
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
    const common =
      'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"';
    const map = {
      straight: `<svg ${common}><path d="M12 20V5"/><path d="m7 10 5-5 5 5"/></svg>`,
      left: `<svg ${common}><path d="M16 20v-7a3 3 0 0 0-3-3H6"/><path d="m10 6-4 4 4 4"/></svg>`,
      right: `<svg ${common}><path d="M8 20v-7a3 3 0 0 1 3-3h7"/><path d="m14 6 4 4-4 4"/></svg>`,
      'slight-left': `<svg ${common}><path d="M14 20v-6l-6-7"/><path d="M8 12V7h5"/></svg>`,
      'slight-right': `<svg ${common}><path d="M10 20v-6l6-7"/><path d="M16 12V7h-5"/></svg>`,
      'sharp-left': `<svg ${common}><path d="M16 20V8l-9 7"/><path d="M7 10v5h5"/></svg>`,
      'sharp-right': `<svg ${common}><path d="M8 20V8l9 7"/><path d="M17 10v5h-5"/></svg>`,
      uturn: `<svg ${common}><path d="M16 20V9a4 4 0 0 0-8 0v6"/><path d="m5 12 3 3 3-3"/></svg>`,
      'fork-left': `<svg ${common}><path d="M12 20v-7L7 6"/><path d="M12 13l5-7" stroke-opacity="0.38"/><path d="M7 11V6h5"/></svg>`,
      'fork-right': `<svg ${common}><path d="M12 20v-7l5-7"/><path d="M12 13L7 6" stroke-opacity="0.38"/><path d="M17 11V6h-5"/></svg>`,
      'ramp-left': `<svg ${common}><path d="M15 20V5" stroke-opacity="0.35"/><path d="M15 16c0-4-4-6-8-8"/><path d="M7 13V8h5"/></svg>`,
      'ramp-right': `<svg ${common}><path d="M9 20V5" stroke-opacity="0.35"/><path d="M9 16c0-4 4-6 8-8"/><path d="M17 13V8h-5"/></svg>`,
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
    const common =
      'width="32" height="32" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"';

    if (pace.grade === 'R1') {
      return `<svg ${common}><g ${flip}><path d="M13 38V16a9 9 0 0 1 18 0v14"/><path d="M24 23l7 7 7-7"/></g></svg>`;
    }
    if (pace.hasChicane) {
      return `<svg ${common}><g ${flip}><path d="M12 38v-8c0-5 16-5 16-11V8"/><path d="M22 14l6-6 6 6"/></g></svg>`;
    }
    if (pace.grade === 'R2' || pace.grade === 'R3') {
      return `<svg ${common}><g ${flip}><path d="M13 38V22c0-7 5-11 13-11h7"/><path d="M27 5l6 6-6 6"/></g></svg>`;
    }
    return `<svg ${common}><g ${flip}><path d="M15 38V25c0-6 4-11 12-15"/><path d="M20 8l8 1-2 8"/></g></svg>`;
  }

  // =========================================================================
  // Toast Notifications
  // =========================================================================
  function showToast(message, type = 'info', durationMs = 2600) {
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
      } catch (_err) {}
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
  // Mapbox GL JS v3 Standard Style Initialization & 3D Route Layers
  // =========================================================================

  /**
   * 画面高さの55%を top padding として常時適用し、自車位置を画面の下部1/4へ固定
   */
  function getCockpitPadding() {
    return {
      top: Math.round(window.innerHeight * 0.55),
      bottom: 0,
      left: 0,
      right: 0,
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
      style: CFG.mapStyle, // mapbox://styles/mapbox/standard
      center: state.vehicle.coords,
      zoom: modeCfg.baseZoom,
      pitch: modeCfg.pitch,
      bearing: state.vehicle.heading,
      maxPitch: 85,
      maxZoom: 22,
      padding: getCockpitPadding(),
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

      // Mapbox Standard Style v3: 夜間ライティング＆3D立体交差・高架橋・車線標示・3D建物を有効化
      try {
        map.setConfigProperty('basemap', 'lightPreset', 'night');
        map.setConfigProperty('basemap', 'show3dObjects', true);
      } catch (_err) {
        // Fallback safety if style config API differs
      }

      setupTerrainAndRouteSources(map);
      setupRouteLayers(map);
      setupEgoVehicleMarker(map);
      map.setPadding(getCockpitPadding());
      applyModeVisuals(state.mode, false);

      if (state.routeModel) {
        syncRouteSourcesToMap();
      }
    });

    // Manual drag/rotate/pitch pauses auto-follow until user taps Recenter
    const pauseFollowOnManualInput = (ev) => {
      if (ev && ev.originalEvent && state.followCamera) {
        setFollowCamera(false);
      }
    };
    map.on('dragstart', pauseFollowOnManualInput);
    map.on('rotatestart', pauseFollowOnManualInput);
    map.on('pitchstart', pauseFollowOnManualInput);

    bindMapDestinationGestures(map);

    window.addEventListener('resize', () => {
      if (state.map && state.mapReady) {
        state.map.setPadding(getCockpitPadding());
      }
    });
  }

  function setupTerrainAndRouteSources(map) {
    // 3D Terrain DEM source (enabled in Mountain Mode)
    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }

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

  /**
   * Standard Style `slot: 'middle'` + `line-emissive-strength: 1` で
   * 夜間ライティング下でも視認性の高い純正ナビブルー（#2563eb / #3b82f6）ルートを描画
   */
  function setupRouteLayers(map) {
    // Traveled trail behind vehicle
    if (!map.getLayer('route-traveled-line')) {
      map.addLayer({
        id: 'route-traveled-line',
        type: 'line',
        slot: 'middle',
        source: 'route-traveled',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-opacity': 0.28,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 5, 19, 10, 21, 14],
          'line-emissive-strength': 1,
        },
      });
    }

    // Route casing (deep blue edge for contrast against asphalt & lane markings)
    if (!map.getLayer('route-casing')) {
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        slot: 'middle',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#1d4ed8',
          'line-opacity': 0.92,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 15, 19.5, 22, 21, 28],
          'line-emissive-strength': 1,
        },
      });
    }

    // Active route core (clean OEM navigation blue #3b82f6)
    if (!map.getLayer('route-core-ribbon')) {
      map.addLayer({
        id: 'route-core-ribbon',
        type: 'line',
        slot: 'middle',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-opacity': 0.98,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 17, 10, 19.5, 15, 21, 20],
          'line-emissive-strength': 1,
        },
      });
    }

    // Upcoming Intersection / JCT highlight segment during close-range 3D zoom
    if (!map.getLayer('jct-segment-core')) {
      map.addLayer({
        id: 'jct-segment-core',
        type: 'line',
        slot: 'middle',
        source: 'route-jct-segment',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#60a5fa',
          'line-opacity': 0.96,
          'line-width': ['interpolate', ['linear'], ['zoom'], 16, 10, 19.5, 17, 21, 22],
          'line-emissive-strength': 1,
        },
      });
    }

    // Subtle target ring at maneuver point during close-range zoom
    if (!map.getLayer('jct-focus-ring')) {
      map.addLayer({
        id: 'jct-focus-ring',
        type: 'circle',
        slot: 'middle',
        source: 'route-jct-beacon',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 10, 20, 18],
          'circle-color': 'rgba(59, 130, 246, 0.25)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
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
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="34" r="22" fill="rgba(15, 15, 20, 0.72)" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5"/>
        <path class="ego-fill" d="M32 15 L45 45 L32 39 L19 45 Z"/>
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
  // 3-Mode Visuals & Guaranteed Proximity Auto-3D Zoom Camera Controller
  // =========================================================================
  function setDrivingMode(modeId, animateCamera = true) {
    if (!CFG.modes[modeId]) return;
    state.mode = modeId;

    // Re-evaluate proximity zoom cleanly for the newly selected mode
    state.autoCloseZoomActive = false;
    state.isCloseZoomActive = state.sim.forceCloseZoom;
    if (!state.isCloseZoomActive) {
      updateJctBeaconOnMap(null);
    }

    dom.modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === modeId);
    });

    applyModeVisuals(modeId, animateCamera);
    evaluateCloseZoomEveryFrame(false);
    refreshGuidanceUi();
    showToast(`${CFG.modes[modeId].label}モードに切替ました`, 'info', 1800);
  }

  function applyModeVisuals(modeId, animateCamera) {
    const map = state.map;
    const modeCfg = CFG.modes[modeId];
    if (!map || !state.mapReady || !modeCfg) return;

    // Standard Style 3D objects remain active (3D interchanges, overpasses, lanes, buildings)
    try {
      map.setConfigProperty('basemap', 'lightPreset', 'night');
      map.setConfigProperty('basemap', 'show3dObjects', true);
    } catch (_err) {}

    // 3D DEM Terrain enabled in Mountain Mode
    if (modeCfg.enableTerrain) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: modeCfg.terrainExaggeration });
    } else {
      map.setTerrain(null);
    }

    const speedKmh = state.vehicle.speedMps * 3.6;
    const targetZoom = Geo.computeSpeedAdaptiveZoom(modeId, speedKmh, state.isCloseZoomActive);
    const targetPitch = Geo.computeTargetPitch(modeId, state.isCloseZoomActive);

    if (animateCamera && state.followCamera) {
      triggerSmoothCameraEase(targetZoom, targetPitch, 950);
    } else {
      state.currentZoom = targetZoom;
      state.currentPitch = targetPitch;
    }
  }

  function triggerSmoothCameraEase(targetZoom, targetPitch, durationMs = 950) {
    if (!state.map || !state.mapReady) return;
    state.isEasingCamera = true;
    state.currentZoom = targetZoom;
    state.currentPitch = targetPitch;

    // Predict vehicle pose at end of easeTo so moving transitions land seamlessly without jump
    let targetCenter = state.vehicle.coords;
    let targetBearing = state.vehicle.heading;
    const isMoving =
      (state.sim.demoMode || state.gps.isDeadReckoning) && state.vehicle.speedMps > 1;
    if (isMoving && state.routeModel && state.vehicle.isSnappedToRoute) {
      const lookaheadKm = (state.vehicle.speedMps * (durationMs / 1000)) / 1000;
      const predDistKm = Geo.clamp(
        state.vehicle.routeDistKm + lookaheadKm,
        0,
        state.routeModel.totalKm
      );
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
      padding: getCockpitPadding(),
      duration: durationMs,
      easing: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      essential: true,
    });

    state.easeTimer = setTimeout(() => {
      state.isEasingCamera = false;
    }, durationMs + 50);
  }

  /**
   * 毎フレーム turf.distance で routes[0].legs[0].steps の各 maneuver.location との距離を計算し、
   * 閾値（市街地 150m / 高速 800m）を下回ったら確実に map.easeTo を発火させる。
   */
  function evaluateCloseZoomEveryFrame(notify = true) {
    const modeCfg = CFG.modes[state.mode];
    const evalResult = Geo.evaluateManeuverProximityZoom(
      state.routeModel,
      state.vehicle.coords,
      state.vehicle.routeDistKm,
      state.mode,
      state.autoCloseZoomActive,
      modeCfg,
      state.vehicle.isSnappedToRoute
    );

    state.autoCloseZoomActive = evalResult.active;
    state.closeZoomStep = evalResult.step;
    state.lastManeuverDirectDistM = evalResult.directDistMeters;

    const effectiveActive = state.sim.forceCloseZoom || state.autoCloseZoomActive;

    if (effectiveActive !== state.isCloseZoomActive) {
      state.isCloseZoomActive = effectiveActive;
      updateJctBeaconOnMap(effectiveActive ? evalResult.step : null);

      const speedKmh = state.vehicle.speedMps * 3.6;
      const targetZoom = Geo.computeSpeedAdaptiveZoom(state.mode, speedKmh, effectiveActive);
      const targetPitch = Geo.computeTargetPitch(state.mode, effectiveActive);

      if (state.followCamera && state.map && state.mapReady) {
        triggerSmoothCameraEase(targetZoom, targetPitch, 900);
      } else {
        state.currentZoom = targetZoom;
        state.currentPitch = targetPitch;
      }

      refreshGuidanceUi();

      if (notify && !state.sim.forceCloseZoom) {
        if (effectiveActive) {
          const label = state.mode === 'highway' ? 'JCT・分岐' : '交差点';
          showToast(
            `${label} ${Geo.formatDistanceJa(evalResult.directDistMeters)}手前 — 至近距離3Dズーム`,
            'info',
            2400
          );
        } else {
          showToast('通過完了 — 通常視点へ復帰', 'info', 2000);
        }
      }
    }
  }

  function toggleForceCloseZoom() {
    state.sim.forceCloseZoom = !state.sim.forceCloseZoom;
    dom.btnForceCloseZoom.classList.toggle('active', state.sim.forceCloseZoom);
    dom.forceCloseZoomLabel.textContent = state.sim.forceCloseZoom
      ? '至近距離カメラ強制中（解除する）'
      : '至近距離カメラを強制 ON';

    // Always follow camera when testing close-up zoom so user sees easeTo immediately
    if (state.sim.forceCloseZoom && !state.followCamera) {
      state.followCamera = true;
      dom.btnRecenter.classList.add('active');
      dom.btnRecenter.classList.remove('attention');
    }

    const effectiveActive = state.sim.forceCloseZoom || state.autoCloseZoomActive;
    state.isCloseZoomActive = effectiveActive;
    updateJctBeaconOnMap(effectiveActive ? state.closeZoomStep : null);

    const speedKmh = state.vehicle.speedMps * 3.6;
    const targetZoom = Geo.computeSpeedAdaptiveZoom(state.mode, speedKmh, effectiveActive);
    const targetPitch = Geo.computeTargetPitch(state.mode, effectiveActive);

    if (state.map && state.mapReady) {
      triggerSmoothCameraEase(targetZoom, targetPitch, 850);
    }

    refreshGuidanceUi();
    showToast(
      state.sim.forceCloseZoom
        ? `至近距離カメラ強制 ON（Zoom ${targetZoom} / Pitch ${targetPitch}°）`
        : `通常カメラへ復帰（Zoom ${targetZoom} / Pitch ${targetPitch}°）`,
      'info',
      2400
    );
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

    if (segSrc && state.routeModel && Number.isFinite(branchStep.routeDistKm)) {
      try {
        const backKm = state.mode === 'highway' ? 0.25 : 0.08;
        const aheadKm = state.mode === 'highway' ? 0.16 : 0.06;
        const s0 = Geo.clamp(branchStep.routeDistKm - backKm, 0, state.routeModel.totalKm);
        const s1 = Geo.clamp(
          branchStep.routeDistKm + aheadKm,
          s0 + 0.015,
          state.routeModel.totalKm
        );
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
      const targetZoom = Geo.computeSpeedAdaptiveZoom(
        state.mode,
        state.vehicle.speedMps * 3.6,
        state.isCloseZoomActive
      );
      const targetPitch = Geo.computeTargetPitch(state.mode, state.isCloseZoomActive);
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
    dom.searchResultsList.innerHTML = '<div class="map-hint-note">検索中...</div>';

    const [lng, lat] = state.vehicle.coords;
    let items = [];

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
    } catch (_err) {}

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
      } catch (_err) {}
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
    } catch (_err) {}
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

    map.on('contextmenu', async (e) => {
      await openPinConfirmation([e.lngLat.lng, e.lngLat.lat]);
    });

    map.on('click', async (e) => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      if (!state.pinModeActive && state.routeModel) return;
      await openPinConfirmation([e.lngLat.lng, e.lngLat.lat]);
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
  // Mapbox Directions API Route Fetch & Route Rendering
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
      state.autoCloseZoomActive = false;
      state.isCloseZoomActive = state.sim.forceCloseZoom;
      state.activePaceNote = null;
      state.lastPaceHeadline = '';

      updateDestinationMarker(destCoords);
      syncRouteSourcesToMap();
      setPinMode(false);
      clearPendingPin();
      setSearchDrawerOpen(false);
      dom.btnClearRoute.classList.remove('hidden');

      updateNavigationAnalytics();
      evaluateCloseZoomEveryFrame(false);
      setFollowCamera(true);

      showToast(
        `ルート設定完了：${Geo.formatDistanceJa(model.totalMeters)}（約${Geo.formatDurationJa(model.totalDurationSec)}）`,
        'info',
        3000
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
    state.autoCloseZoomActive = false;
    state.isCloseZoomActive = state.sim.forceCloseZoom;
    state.closeZoomStep = null;
    state.lastManeuverDirectDistM = Infinity;

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

    state.gps.watchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 5000,
    });
  }

  function onGpsPosition(pos) {
    if (state.sim.demoMode || state.sim.tunnelLost) return;

    const { longitude, latitude, heading, speed, accuracy, altitude } = pos.coords;
    const now = Date.now();

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
      if (
        computedHeading === null &&
        movedM > 2.5 &&
        (computedSpeedMps || 0) >= CFG.gps.minHeadingSpeedMps
      ) {
        computedHeading = Geo.normalizeBearing(
          turf.bearing(turf.point(state.gps.lastFixCoords), turf.point(newCoords))
        );
      }
    }

    const wasFirstFix = !state.gps.hasFix;
    state.gps.hasFix = true;
    state.gps.lastFixTime = now;
    state.gps.lastFixCoords = newCoords;

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
        state.vehicle.heading = computedHeading !== null ? computedHeading : snap.routeHeading;
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

    const activeSpeedMps = state.sim.demoMode
      ? state.sim.demoSpeedKmh / 3.6
      : state.gps.lastValidSpeedMps > 0.5
      ? state.gps.lastValidSpeedMps
      : state.sim.tunnelLost
      ? state.sim.demoSpeedKmh / 3.6
      : 0;
    state.sim.lockedTunnelSpeedMps = activeSpeedMps;
    state.vehicle.speedMps = activeSpeedMps;

    if (state.egoMarkerEl) state.egoMarkerEl.classList.add('is-dr');
    updateGpsStatusUi();
    showToast(`自律航法（Dead Reckoning）へ切替：${reason}`, 'warn', 3000);
  }

  function exitDeadReckoning() {
    if (!state.gps.isDeadReckoning) return;
    state.gps.isDeadReckoning = false;
    state.gps.drMode = 'OFF';
    state.sim.lockedTunnelSpeedMps = null;
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
  // Core 60fps Kinematic, Per-Frame Proximity Zoom & Camera Loop
  // =========================================================================
  function tickAnimationLoop(ts) {
    if (!state.lastFrameTs) state.lastFrameTs = ts;
    const dtSec = Math.min(0.15, Math.max(0.001, (ts - state.lastFrameTs) / 1000));
    state.lastFrameTs = ts;

    // 1. Kinematic step (Dead Reckoning OR Virtual Demo Drive)
    if (state.gps.isDeadReckoning) {
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

    // 2. Per-frame turf.distance check against routes[0].legs[0].steps maneuver.location
    if (state.routeModel) {
      evaluateCloseZoomEveryFrame(true);
    }

    // 3. Smooth display interpolation & 3D Mapbox Camera update
    const smoothFactor = Math.min(1, dtSec * 10);
    state.displayCoords[0] += (state.vehicle.coords[0] - state.displayCoords[0]) * smoothFactor;
    state.displayCoords[1] += (state.vehicle.coords[1] - state.displayCoords[1]) * smoothFactor;
    state.displayHeading = Geo.lerpBearing(state.displayHeading, state.vehicle.heading, smoothFactor);

    if (state.map && state.mapReady) {
      if (state.egoMarker) {
        state.egoMarker.setLngLat(state.displayCoords);
        state.egoMarker.setRotation(state.displayHeading);
      }

      if (state.mode === 'mountain' && typeof state.map.queryTerrainElevation === 'function') {
        const elev = state.map.queryTerrainElevation(state.displayCoords, { exaggerated: false });
        if (Number.isFinite(elev)) {
          state.vehicle.altitudeM = Math.round(elev);
        }
      }

      if (state.followCamera && !state.isEasingCamera) {
        const speedKmh = state.vehicle.speedMps * 3.6;
        const desiredZoom = Geo.computeSpeedAdaptiveZoom(
          state.mode,
          speedKmh,
          state.isCloseZoomActive
        );
        const desiredPitch = Geo.computeTargetPitch(state.mode, state.isCloseZoomActive);

        const zoomLerp = Math.min(1, dtSec * 2.6);
        state.currentZoom += (desiredZoom - state.currentZoom) * zoomLerp;
        state.currentPitch += (desiredPitch - state.currentPitch) * zoomLerp;

        state.map.jumpTo({
          center: state.displayCoords,
          bearing: state.displayHeading,
          zoom: state.currentZoom,
          pitch: state.currentPitch,
          padding: getCockpitPadding(),
        });
      }
    }

    // 4. Update Instrument Cluster & Debug Readouts
    renderSpeedometerAndTelemetry();
    if (state.gps.isDeadReckoning) {
      updateGpsStatusUi();
    }

    requestAnimationFrame(tickAnimationLoop);
  }

  // =========================================================================
  // Navigation Analytics (Steps / Highway Branch / Mountain Pace Notes)
  // =========================================================================
  function updateNavigationAnalytics() {
    if (!state.routeModel) {
      state.navProgress = null;
      state.activePaceNote = null;
      refreshGuidanceUi();
      return;
    }

    state.navProgress = Geo.getNavigationProgress(state.routeModel, state.vehicle.routeDistKm);

    if (state.mode === 'mountain') {
      state.activePaceNote = Geo.analyzeMountainPaceNote(
        state.routeModel,
        state.vehicle.routeDistKm,
        {
          lookaheadMinMeters: CFG.modes.mountain.lookaheadMinMeters,
          lookaheadMaxMeters: CFG.modes.mountain.lookaheadMaxMeters,
        }
      );
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

    const ratio = Geo.clamp(speedKmh / 160, 0, 1);
    dom.speedBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;

    const hdg = Math.round(Geo.normalizeBearing(state.displayHeading))
      .toString()
      .padStart(3, '0');
    dom.headingVal.textContent = `${hdg}° ${Geo.bearingToCompass(state.displayHeading)}`;

    const modeCode = CFG.modes[state.mode].code;
    const altStr = state.vehicle.altitudeM !== null ? `${state.vehicle.altitudeM}m` : '--m';
    dom.altModeVal.textContent = `${modeCode} · ${altStr}`;

    if (state.destination && state.navProgress) {
      dom.destTriggerTitle.textContent = state.destination.name;
      dom.destTriggerMeta.textContent = `残り ${Geo.formatDistanceJa(state.navProgress.remainingMeters)} · 約${Geo.formatDurationJa(state.navProgress.remainingSeconds)}`;
    }

    if (state.debugOpen) {
      dom.dbgZoom.textContent = state.map ? state.map.getZoom().toFixed(2) : '--';
      dom.dbgPitch.textContent = state.map ? `${Math.round(state.map.getPitch())}°` : '--';
      dom.dbgAutoZoom.textContent = state.sim.forceCloseZoom
        ? 'FORCED'
        : state.autoCloseZoomActive
        ? 'ACTIVE'
        : 'OFF';
      dom.dbgDrMode.textContent = state.gps.isDeadReckoning ? state.gps.drMode : 'OFF';
      dom.dbgBranch.textContent = Number.isFinite(state.lastManeuverDirectDistM)
        ? Geo.formatDistanceJa(state.lastManeuverDirectDistM)
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
      dom.gpsPrimary.textContent = 'DEAD RECKONING（自律航法中）';
      dom.gpsSecondary.textContent = `${snapTag} · ${distStr} (${sec}s)`;
      return;
    }

    if (state.sim.demoMode) {
      dom.gpsCard.classList.add('status-online');
      dom.gpsPrimary.textContent = 'GPS ONLINE (SIM)';
      dom.gpsSecondary.textContent = `仮想走行 · ${state.sim.demoSpeedKmh} km/h`;
      return;
    }

    if (state.gps.hasFix) {
      dom.gpsCard.classList.add('status-online');
      const acc = state.vehicle.accuracyM !== null ? `±${state.vehicle.accuracyM}m` : '高精度';
      const snap = state.vehicle.isSnappedToRoute ? ' · ルート一致' : '';
      dom.gpsPrimary.textContent = 'GPS ONLINE';
      dom.gpsSecondary.textContent = `精度 ${acc}${snap}`;
      return;
    }

    dom.gpsCard.classList.add('status-acquiring');
    dom.gpsPrimary.textContent = 'GPS STANDBY';
    dom.gpsSecondary.textContent = '位置情報待機 / SIMでテスト可';
  }

  function refreshGuidanceUi() {
    const mode = state.mode;
    const nav = state.navProgress;

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
          ? '前方曲率ペースノート · 連続S字'
          : '前方曲率ペースノート';
        dom.paceHeadline.textContent = p.headline;
        dom.paceSubline.textContent = p.subline;
      } else {
        state.lastPaceHeadline = '';
        dom.mountainClearPill.classList.remove('hidden');
        dom.mountainStatusText.textContent = state.routeModel
          ? '前方300m 緩やか（急カーブなし）'
          : 'ルート設定で実ルート曲率ペースノート稼働';
      }
      return;
    }

    // --- City & Highway Mode HUD ---
    if (!nav) {
      dom.guidanceBanner.className = 'hud-panel guidance-banner';
      dom.maneuverIconBox.innerHTML = getManeuverSvg('straight');
      dom.guidanceDistance.textContent = mode === 'highway' ? '高速' : '案内待機';
      dom.guidanceTag.textContent = mode === 'highway' ? 'IC / JCT 監視' : 'Standard 3D';
      dom.jctZoomBadge.classList.toggle('hidden', !state.sim.forceCloseZoom);
      if (state.sim.forceCloseZoom) dom.jctZoomBadge.textContent = '強制3Dズーム';
      dom.guidanceInstruction.textContent = '目的地を設定してルート案内を開始';
      dom.guidanceSub.textContent = '左下の検索、またはマップ長押しで目的地を指定できます';
      return;
    }

    if (mode === 'highway') {
      const branch = state.closeZoomStep || nav.nextBranch;
      const distMeters = Number.isFinite(state.lastManeuverDirectDistM)
        ? state.lastManeuverDirectDistM
        : nav.distToBranchMeters;

      dom.guidanceBanner.className = 'hud-panel guidance-banner';
      dom.maneuverIconBox.innerHTML = getManeuverSvg(branch.maneuverKey);
      dom.guidanceDistance.textContent = Geo.formatDistanceJa(distMeters);
      dom.guidanceTag.textContent = nav.isFallbackBranch ? '次の案内' : branch.branchTag;
      dom.jctZoomBadge.classList.toggle('hidden', !state.isCloseZoomActive);
      dom.jctZoomBadge.textContent = state.sim.forceCloseZoom ? '強制3Dズーム' : 'JCT 3Dズーム';
      dom.guidanceInstruction.textContent = branch.title || branch.instruction;
      dom.guidanceSub.textContent = state.isCloseZoomActive
        ? `800m以内接近 · 立体交差3D近接表示中（${branch.instruction}）`
        : branch.instruction;
    } else {
      const step = state.closeZoomStep || nav.nextStep;
      const distMeters = Number.isFinite(state.lastManeuverDirectDistM)
        ? state.lastManeuverDirectDistM
        : nav.distToStepMeters;

      dom.guidanceBanner.className = 'hud-panel guidance-banner';
      dom.maneuverIconBox.innerHTML = getManeuverSvg(step.maneuverKey);
      dom.guidanceDistance.textContent = Geo.formatDistanceJa(distMeters);
      dom.guidanceTag.textContent = step.maneuver.type === 'arrive' ? '到着' : '次の交差点';
      dom.jctZoomBadge.classList.toggle('hidden', !state.isCloseZoomActive);
      dom.jctZoomBadge.textContent = state.sim.forceCloseZoom ? '強制3Dズーム' : '交差点ズーム';
      dom.guidanceInstruction.textContent = step.instruction || step.title;
      dom.guidanceSub.textContent = state.isCloseZoomActive
        ? '150m以内接近 · 車線・交差点至近距離ビュー'
        : nav.followingStep
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
    if (open) setDebugDrawerOpen(false);
  }

  function setDebugDrawerOpen(open) {
    state.debugOpen = open;
    dom.debugDrawer.classList.toggle('collapsed', !open);
    dom.btnDebugToggle.classList.toggle('active', open);
    if (open) setSearchDrawerOpen(false);
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
    dom.modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => setDrivingMode(btn.dataset.mode, true));
    });

    dom.btnDestToggle.addEventListener('click', () => setSearchDrawerOpen(!state.searchOpen));
    dom.btnSearchClose.addEventListener('click', () => setSearchDrawerOpen(false));
    dom.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchPlaces(dom.searchInput.value);
    });
    dom.btnMapPinMode.addEventListener('click', () => setPinMode(!state.pinModeActive));
    dom.btnClearRoute.addEventListener('click', clearActiveRoute);

    dom.btnPinRoute.addEventListener('click', () => {
      if (state.pendingPin) {
        setDestinationAndFetchRoute(state.pendingPin.coords, state.pendingPin.name);
      }
    });
    dom.btnPinCancel.addEventListener('click', clearPendingPin);

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

    // Debug: Demo Drive Toggle
    dom.toggleDemoMode.addEventListener('change', async () => {
      const enabled = dom.toggleDemoMode.checked;
      if (enabled && !state.routeModel) {
        const match = CFG.demoPresets.find((p) => p.mode === state.mode) || CFG.demoPresets[0];
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
      state.autoCloseZoomActive = false;
      state.isCloseZoomActive = state.sim.forceCloseZoom;
      updateJctBeaconOnMap(null);
      syncRouteSourcesToMap();
      updateNavigationAnalytics();
      evaluateCloseZoomEveryFrame(false);
      setFollowCamera(true);
      showToast('スタート地点へ戻しました');
    });

    // Debug: Force Intersection / JCT Close-Up Camera Verification Button
    dom.btnForceCloseZoom.addEventListener('click', toggleForceCloseZoom);

    // Debug: Tunnel / GPS Lost Toggle
    dom.toggleTunnelSim.addEventListener('change', () => {
      const lost = dom.toggleTunnelSim.checked;
      state.sim.tunnelLost = lost;
      if (lost) {
        if (state.sim.demoSpeedKmh === 0 && state.gps.lastValidSpeedMps < 0.5) {
          applyDemoSpeed(70);
        }
        enterDeadReckoning('トンネル進入シミュレーション');
      } else {
        exitDeadReckoning();
        showToast('トンネル脱出 — GPSオンライン復帰');
      }
    });

    // Token Modal
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

    requestWakeLock(true);
    startGeolocation();
    requestAnimationFrame(tickAnimationLoop);

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
