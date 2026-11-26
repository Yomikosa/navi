/**
 * AERO-DRIVE 3D Digital Cockpit — Application Controller
 *
 * Stack:
 *  - Mapbox GL JS v3 (mapbox://styles/mapbox/standard, Night/Dusk/Day lightPreset, 3D objects)
 *  - Three.js Custom WebGL 3D Vehicle Layer (js/car3d-layer.js, Z=0 tire pivot + height fine-tune slider)
 *  - Turf.js v6 (js/geometry.js: -3.5m turf.lineOffset left-lane route, Smoothstep continuous camera, DR)
 *  - Commercial Automotive Full-Screen Menu (Destination / Route Edit w/ Waypoints / Settings & Demo)
 */
(function () {
  'use strict';

  const Geo = window.NaviGeometry;
  const CFG = window.APP_CONFIG;
  const MODE_ORDER = ['city', 'highway', 'mountain'];
  const UNDERPASS_OPACITY = 0.22;

  // =========================================================================
  // Application State
  // =========================================================================
  const state = {
    accessToken: '',
    map: null,
    mapReady: false,

    // Active driving mode: 'city' | 'highway' | 'mountain'
    mode: 'city',

    // Continuous Smoothstep + 0.08 Damping Camera Controller (zero abrupt jumps)
    followCamera: true,
    cam: {
      center: [...CFG.defaultCenter],
      bearing: CFG.defaultBearing,
      zoom: CFG.modes.city.baseZoom,
      pitch: CFG.modes.city.pitch,
      targetZoom: CFG.modes.city.baseZoom,
      targetPitch: CFG.modes.city.pitch,
      approachT: 0,
      easedT: 0,
      isApproaching: false,
      approachStep: null,
      lastManeuverDistM: Infinity,
      lastApplied: null,
    },

    // Overpass vs Underpass Hit-Test & See-Through Manager
    elevation: {
      state: 'surface', // 'surface' | 'elevated' | 'underpass'
      hasBridgeOverhead: false,
      hasBridgeUnderEgo: false,
      hasMotorwayUnderEgo: false,
      isHighwayRoute: false,
      groundElevationM: 0,
      show3dObjectsApplied: true,
      dimmedBridgeLayers: new Map(),
    },

    // Mountain Mode Initial-D Curve Warning State (500ms throttle + 2.5s lock)
    mountainCurve: {
      lastEvalTs: 0,
      lockedUntilTs: 0,
      displayed: null,
      evalIntervalMs: 500,
      lockDurationMs: 2500,
    },

    // Vehicle kinematic state (tracks left-lane shifted routeModel.line)
    displayCoords: [...CFG.defaultCenter],
    displayHeading: CFG.defaultBearing,
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

    // Active Navigation Route, Waypoints & Preference
    routeModel: null,
    origin: { name: '現在地', coords: [...CFG.defaultCenter] },
    waypoints: [], // [{ name, coords }]
    destination: null, // { name, coords }
    routePreference: 'highway', // 'highway' | 'local'
    navProgress: null,

    // WebGL 3D Car Layer & Destination Pin Markers
    car3d: null,
    destMarker: null,
    waypointMarkers: [],
    pinModeActive: false,
    pendingPin: null,
    pendingPinMarker: null,

    // Settings, Simulation & Debug Controls
    settings: {
      carHeightOffsetM: 0, // -5.0m .. +20.0m fine-tune offset slider
      lightPreset: 'night', // 'night' | 'dusk' | 'day'
    },
    sim: {
      demoMode: false,
      demoSpeedKmh: 60,
      tunnelLost: false,
      forceCloseZoom: false,
      forceUnderpassSeeThrough: false,
      lockedTunnelSpeedMps: null,
    },

    // Screen Wake Lock
    wakeLock: {
      sentinel: null,
      enabled: true,
      supported: 'wakeLock' in navigator,
    },

    // Full-Screen Menu UI State
    menuOpen: false,
    activeMenuTab: 'destination', // 'destination' | 'route' | 'settings'
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
    mapContainer: $('map'),

    // Left Edge: OEM Hardware Capacitive Touch Bezel
    navBezel: $('nav-bezel'),
    bezelClock: $('bezel-clock'),
    btnModeCycle: $('btn-mode-cycle'),
    modeCycleIcon: $('mode-cycle-icon'),
    modeCycleLabel: $('mode-cycle-label'),
    btnMenuToggle: $('btn-menu-toggle'),
    btnRecenter: $('btn-recenter'),

    // Right Edge (Pattern B): Tesla-style Unified Panel
    teslaPanel: $('tesla-panel'),
    speedValue: $('speed-value'),
    speedBarFill: $('speed-bar-fill'),
    headingVal: $('heading-val'),
    modeStatusPill: $('mode-status-pill'),
    gpsStatusPill: $('gps-status-pill'),
    gpsPrimaryLabel: $('gps-primary-label'),
    elevationStatusPill: $('elevation-status-pill'),
    demoActiveChip: $('demo-active-chip'),

    maneuverIconBox: $('maneuver-icon-box'),
    guidanceDistance: $('guidance-distance'),
    zoomActivePill: $('zoom-active-pill'),
    guidanceTag: $('guidance-tag'),
    guidanceInstruction: $('guidance-instruction'),
    routeDestName: $('route-dest-name'),
    routeEtaVal: $('route-eta-val'),

    // Top-Center: Mountain Initial-D Curve Card
    initialdCurveCard: $('initiald-curve-card'),
    initialdArrowBox: $('initiald-arrow-box'),
    initialdDirLabel: $('initiald-dir-label'),
    initialdRankLabel: $('initiald-rank-label'),

    // Full-Screen Commercial Automotive Navigation Menu
    fullscreenMenu: $('fullscreen-menu'),
    fsMenuRouteBadge: $('fs-menu-route-badge'),
    btnMenuClose: $('btn-menu-close'),
    menuTabBtns: document.querySelectorAll('.fs-cat-btn'),
    menuTabPanels: {
      destination: $('tab-panel-destination'),
      route: $('tab-panel-route'),
      settings: $('tab-panel-settings'),
    },

    // Tab 1: Destination
    searchForm: $('search-form'),
    searchInput: $('search-input'),
    btnMapPinMode: $('btn-map-pin-mode'),
    searchResultsSection: $('search-results-section'),
    searchResultsList: $('search-results-list'),
    presetList: $('preset-list'),

    // Tab 2: Route Edit
    btnRoutePrefHighway: $('btn-route-pref-highway'),
    btnRoutePrefLocal: $('btn-route-pref-local'),
    btnRouteRecalc: $('btn-route-recalc'),
    routeEditSummary: $('route-edit-summary'),
    routeTimelineList: $('route-timeline-list'),
    waypointSearchForm: $('waypoint-search-form'),
    waypointSearchInput: $('waypoint-search-input'),
    waypointResultsList: $('waypoint-results-list'),
    btnClearRoute: $('btn-clear-route'),

    // Tab 3: Settings & Demo
    toggleDemoMode: $('toggle-demo-mode'),
    sliderDemoSpeed: $('slider-demo-speed'),
    demoSpeedLabel: $('demo-speed-label'),
    speedChipBtns: document.querySelectorAll('.speed-chip-btn'),
    btnDemoReset: $('btn-demo-reset'),

    sliderCarHeight: $('slider-car-height'),
    carHeightLabel: $('car-height-label'),
    btnCarHeightReset: $('btn-car-height-reset'),

    lightPresetBtns: document.querySelectorAll('.light-preset-btn'),
    toggleUnderpassSeeThrough: $('toggle-underpass-see-through'),
    toggleTunnelSim: $('toggle-tunnel-sim'),
    toggleForceCloseZoom: $('toggle-force-close-zoom'),

    btnWakelock: $('btn-wakelock'),
    wakelockLabel: $('wakelock-label'),
    btnFullscreen: $('btn-fullscreen'),
    btnTokenSettings: $('btn-token-settings'),

    dbgZoom: $('dbg-zoom'),
    dbgPitch: $('dbg-pitch'),
    dbgApproach: $('dbg-approach'),
    dbgElev: $('dbg-elev'),
    dbgCarZ: $('dbg-car-z'),
    dbgDrMode: $('dbg-dr-mode'),

    // Pin Confirmation & Toast
    pinConfirmBar: $('pin-confirm-bar'),
    pinConfirmTitle: $('pin-confirm-title'),
    pinConfirmCoords: $('pin-confirm-coords'),
    btnPinRoute: $('btn-pin-route'),
    btnPinCancel: $('btn-pin-cancel'),
    hudToast: $('hud-toast'),

    // Token Modal & Portrait Advisory
    tokenModalBackdrop: $('token-modal-backdrop'),
    tokenInput: $('token-input'),
    tokenErrorMsg: $('token-error-msg'),
    btnTokenSave: $('btn-token-save'),
    btnTokenCancel: $('btn-token-cancel'),
    btnTokenClear: $('btn-token-clear'),
    btnAllowPortrait: $('btn-allow-portrait'),
  };

  // =========================================================================
  // SVG Icon Library (Bezel Touch Icons / Turn Maneuvers / Initial-D Arrows)
  // =========================================================================
  function getModeIconSvg(modeId) {
    const common =
      'width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
    if (modeId === 'highway') {
      return `<svg ${common}><path d="M6 21 9 3M18 21 15 3M12 6v3M12 13v3M12 19v2"/></svg>`;
    }
    if (modeId === 'mountain') {
      return `<svg ${common}><path d="m3 20 7-13 4 7 3-5 4 11H3Z"/></svg>`;
    }
    return `<svg ${common}><path d="M3 21h18M5 21V7l6-4v18M13 21V11l6-3v13M8 10h.01M8 14h.01M16 14h.01M16 17h.01"/></svg>`;
  }

  function getModeBezelLabel(modeId) {
    if (modeId === 'highway') return 'HIGHWAY';
    if (modeId === 'mountain') return 'MOUNTAIN';
    return 'CITY';
  }

  function getManeuverSvg(key) {
    const common =
      'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"';
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

  function getInitialDCurveSvg(curve) {
    const isRight = curve.direction === 'right';
    const flip = isRight ? '' : 'transform="scale(-1,1) translate(-64,0)"';
    const common =
      'width="52" height="52" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"';

    if (curve.tier === 'HAIRPIN') {
      return `<svg ${common}><g ${flip}><path d="M18 54V22a13 13 0 0 1 26 0v22"/><path d="M34 35l10 10 10-10"/></g></svg>`;
    }
    if (curve.tier === 'HARD') {
      return `<svg ${common}><g ${flip}><path d="M18 54V26c0-5 4-9 9-9h23"/><path d="M40 8l10 9-10 9"/></g></svg>`;
    }
    if (curve.tier === 'MEDIUM') {
      return `<svg ${common}><g ${flip}><path d="M20 54V34c0-11 8-19 20-21l9-1"/><path d="M39 5l11 7-9 10"/></g></svg>`;
    }
    return `<svg ${common}><g ${flip}><path d="M24 54V36c0-8 4-15 14-23"/><path d="M27 12l12 0-1 12"/></g></svg>`;
  }

  // =========================================================================
  // Live Clock & Toast Notifications
  // =========================================================================
  function updateLiveClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    dom.bezelClock.textContent = `${hh}:${mm}`;
  }

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
      state.car3d = null;
      state.cam.lastApplied = null;
      state.elevation.dimmedBridgeLayers.clear();
      state.elevation.show3dObjectsApplied = true;
    }
    initMapbox();
    showToast('Mapbox トークンを設定しました');
  }

  // =========================================================================
  // Mapbox GL JS v3 Standard Style Initialization, Route Layers & WebGL 3D Car
  // =========================================================================
  function getCockpitPadding() {
    const h = (dom.mapContainer && dom.mapContainer.clientHeight) || window.innerHeight;
    return {
      top: Math.round(h * 0.55),
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
      style: CFG.mapStyle, // 'mapbox://styles/mapbox/standard'
      config: {
        basemap: {
          lightPreset: state.settings.lightPreset,
          show3dObjects: true,
        },
      },
      center: state.vehicle.coords,
      zoom: modeCfg.baseZoom,
      pitch: modeCfg.pitch,
      bearing: state.vehicle.heading,
      maxPitch: 85,
      maxZoom: 22,
      antialias: true,
      attributionControl: true,
    });

    state.map = map;
    state.mapReady = false;
    state.cam.center = [...state.displayCoords];
    state.cam.bearing = state.displayHeading;
    state.cam.zoom = modeCfg.baseZoom;
    state.cam.pitch = modeCfg.pitch;
    state.cam.targetZoom = modeCfg.baseZoom;
    state.cam.targetPitch = modeCfg.pitch;
    state.cam.lastApplied = null;
    state.elevation.show3dObjectsApplied = true;
    state.elevation.dimmedBridgeLayers.clear();

    map.on('error', (e) => {
      const status = e && e.error && e.error.status;
      if (!state.mapReady && (status === 401 || status === 403)) {
        showToast('Mapboxアクセストークンが無効です。設定のAPI KEYから再設定してください。', 'error', 5000);
        openTokenModal(false);
      }
    });

    map.on('style.load', () => {
      // Standard Style 3D設定（独自の fill-extrusion 建物レイヤーは絶対に追加しない）
      try {
        map.setConfigProperty('basemap', 'lightPreset', state.settings.lightPreset);
        map.setConfigProperty('basemap', 'show3dObjects', true);
        state.elevation.show3dObjectsApplied = true;
      } catch (_err) {}
      try {
        map.setConfigProperty('basemap', 'showHdRoads', true);
      } catch (_err) {}

      // ソース・ルートレイヤー・WebGL 3D自車カスタムレイヤーを style.load 完了後に追加
      setupTerrainAndRouteSources(map);
      setupRouteLayers(map);
      setupEgo3DCarLayer(map);

      state.mapReady = true;

      const pad = getCockpitPadding();
      map.jumpTo({
        center: state.cam.center,
        bearing: state.cam.bearing,
        zoom: state.cam.zoom,
        pitch: state.cam.pitch,
        padding: pad,
      });
      recordCameraSnapshot(
        state.cam.center,
        state.cam.bearing,
        state.cam.zoom,
        state.cam.pitch,
        pad.top
      );

      applyTerrainForMode(state.mode);
      if (state.routeModel) {
        syncRouteSourcesToMap();
      }
      evaluateElevationAndSeeThrough(performance.now(), true);
    });

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
        const pad = getCockpitPadding();
        state.map.setPadding(pad);
        state.cam.lastApplied = null;
      }
    });
  }

  function setupTerrainAndRouteSources(map) {
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
      map.addSource('route-remaining', { type: 'geojson', data: emptyFc });
    }
    if (!map.getSource('route-jct-segment')) {
      map.addSource('route-jct-segment', { type: 'geojson', data: emptyFc });
    }
    if (!map.getSource('route-jct-beacon')) {
      map.addSource('route-jct-beacon', { type: 'geojson', data: emptyFc });
    }
  }

  /**
   * turf.lineOffset(-3.5m) で左車線へシフト済みのルート座標を描画する半透明スリムライン
   *  - slot: 'middle'（路面標示の下に敷く）、line-opacity: 0.55
   *  - 高架区間走行時: route-elevated-top (slot: 'top') で3D高架ポリゴン上にも確実に表示
   *  - 高架下走行時: route-xray-underpass で透過表示
   */
  function setupRouteLayers(map) {
    const laneWidth = ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 10, 20, 18];

    if (!map.getLayer('route-traveled-line')) {
      map.addLayer({
        id: 'route-traveled-line',
        type: 'line',
        slot: 'middle',
        source: 'route-traveled',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-opacity': 0.2,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 8, 20, 14],
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.3,
        },
      });
    }

    if (!map.getLayer('route-core-ribbon')) {
      map.addLayer({
        id: 'route-core-ribbon',
        type: 'line',
        slot: 'middle',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-opacity': 0.55,
          'line-width': laneWidth,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.45,
        },
      });
    }

    if (!map.getLayer('jct-segment-core')) {
      map.addLayer({
        id: 'jct-segment-core',
        type: 'line',
        slot: 'middle',
        source: 'route-jct-segment',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#60a5fa',
          'line-opacity': 0.45,
          'line-width': laneWidth,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.5,
        },
      });
    }

    // 高架区間走行時のみ有効化する slot: 'top' オーバーレイ
    if (!map.getLayer('route-elevated-top')) {
      map.addLayer({
        id: 'route-elevated-top',
        type: 'line',
        slot: 'top',
        source: 'route-remaining',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: 'none',
        },
        paint: {
          'line-color': '#3b82f6',
          'line-opacity': 0.55,
          'line-width': laneWidth,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.65,
        },
      });
    }

    // 高架下走行時のみ有効化する X-Ray オクルージョン透過ルートレイヤー
    if (!map.getLayer('route-xray-underpass')) {
      map.addLayer({
        id: 'route-xray-underpass',
        type: 'line',
        slot: 'top',
        source: 'route-remaining',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: 'none',
        },
        paint: {
          'line-color': '#60a5fa',
          'line-opacity': 0.45,
          'line-width': laneWidth,
          'line-dasharray': [2, 1.5],
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.65,
        },
      });
    }

    if (!map.getLayer('jct-focus-ring')) {
      map.addLayer({
        id: 'jct-focus-ring',
        type: 'circle',
        slot: 'middle',
        source: 'route-jct-beacon',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 9, 20, 15],
          'circle-color': 'rgba(59, 130, 246, 0.22)',
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
          'circle-pitch-alignment': 'map',
          'circle-emissive-strength': 1,
        },
      });
    }
  }

  /**
   * WebGL 3D空間内の立体3D車両（Three.js CustomLayer）を復元配置
   * 底面（タイヤ接地面）Z=0 厳密補正 + queryTerrainElevation + ユーザー微調整オフセット
   */
  function setupEgo3DCarLayer(map) {
    if (!window.Car3DLayer || !window.THREE) {
      return;
    }
    if (map.getLayer('ego-car-3d-layer')) {
      try {
        map.removeLayer('ego-car-3d-layer');
      } catch (_err) {}
    }

    state.car3d = window.Car3DLayer.createCar3DLayer({
      id: 'ego-car-3d-layer',
      initialCoords: state.displayCoords,
      initialHeading: state.displayHeading,
      initialHeightOffsetM: state.settings.carHeightOffsetM,
    });

    try {
      map.addLayer(state.car3d.layer);
    } catch (_err) {
      state.car3d = null;
    }
  }

  function updateDestinationAndWaypointMarkers() {
    if (!state.map) return;

    if (state.destMarker) {
      state.destMarker.remove();
      state.destMarker = null;
    }
    state.waypointMarkers.forEach((m) => m.remove());
    state.waypointMarkers = [];

    state.waypoints.forEach((wp) => {
      const el = document.createElement('div');
      el.className = 'dest-pin-marker';
      el.innerHTML =
        '<div class="dest-pin-ring" style="background:#d97706;"><div class="dest-pin-core"></div></div>';
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(wp.coords)
        .addTo(state.map);
      state.waypointMarkers.push(marker);
    });

    if (state.destination && state.destination.coords) {
      const el = document.createElement('div');
      el.className = 'dest-pin-marker';
      el.innerHTML = '<div class="dest-pin-ring"><div class="dest-pin-core"></div></div>';
      state.destMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(state.destination.coords)
        .addTo(state.map);
    }
  }

  // =========================================================================
  // Per-Frame Ground / Bridge Hit-Test & Overpass/Underpass Visuals
  // =========================================================================
  function queryRenderedRoadFeaturesAtEgo(map, lngLat) {
    if (!map || !state.mapReady || !Array.isArray(lngLat)) return [];
    try {
      const pt = map.project(lngLat);
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return [];
      const pad = 16;
      return (
        map.queryRenderedFeatures([
          [pt.x - pad, pt.y - pad],
          [pt.x + pad, pt.y + pad],
        ]) || []
      );
    } catch (_err) {
      return [];
    }
  }

  function setStyleBridgeLayersOpacity(map, dimmed) {
    if (!map || !state.mapReady) return;
    const store = state.elevation.dimmedBridgeLayers;
    const ownIds = new Set([
      'route-traveled-line',
      'route-core-ribbon',
      'jct-segment-core',
      'route-elevated-top',
      'route-xray-underpass',
      'jct-focus-ring',
      'ego-car-3d-layer',
    ]);

    if (!dimmed) {
      store.forEach((savedProps, layerId) => {
        if (!map.getLayer(layerId)) return;
        savedProps.forEach((origVal, propName) => {
          try {
            map.setPaintProperty(layerId, propName, origVal);
          } catch (_e) {}
        });
      });
      store.clear();
      return;
    }

    let styleLayers = [];
    try {
      const styleObj = map.getStyle();
      styleLayers = (styleObj && Array.isArray(styleObj.layers) && styleObj.layers) || [];
    } catch (_e) {
      return;
    }

    styleLayers.forEach((layer) => {
      if (!layer || !layer.id || ownIds.has(layer.id)) return;
      const filterStr = layer.filter ? JSON.stringify(layer.filter) : '';
      const isBridgeLayer = /(bridge|elevated|viaduct|overpass)/i.test(`${layer.id} ${filterStr}`);
      if (!isBridgeLayer) return;

      const propsToDim = [];
      if (layer.type === 'fill') propsToDim.push('fill-opacity');
      else if (layer.type === 'line') propsToDim.push('line-opacity');
      else if (layer.type === 'symbol') propsToDim.push('icon-opacity', 'text-opacity');
      else if (layer.type === 'fill-extrusion') propsToDim.push('fill-extrusion-opacity');

      if (propsToDim.length === 0) return;

      if (!store.has(layer.id)) {
        const saved = new Map();
        propsToDim.forEach((propName) => {
          try {
            saved.set(propName, map.getPaintProperty(layer.id, propName));
          } catch (_e) {
            saved.set(propName, undefined);
          }
        });
        store.set(layer.id, saved);
      }

      propsToDim.forEach((propName) => {
        try {
          map.setPaintProperty(layer.id, propName, UNDERPASS_OPACITY);
        } catch (_e) {}
      });
    });
  }

  function applyElevationVisuals(elevState) {
    const map = state.map;
    const isElevated = elevState === 'elevated';
    const isUnderpass = elevState === 'underpass';

    if (!map || !state.mapReady) {
      updateElevationBadgeUi();
      return;
    }

    setStyleBridgeLayersOpacity(map, isUnderpass);

    const desiredShow3d = !isUnderpass;
    if (state.elevation.show3dObjectsApplied !== desiredShow3d) {
      try {
        map.setConfigProperty('basemap', 'show3dObjects', desiredShow3d);
        state.elevation.show3dObjectsApplied = desiredShow3d;
      } catch (_e) {}
    }

    if (map.getLayer('route-elevated-top')) {
      try {
        map.setLayoutProperty('route-elevated-top', 'visibility', isElevated ? 'visible' : 'none');
      } catch (_e) {}
    }

    if (map.getLayer('route-xray-underpass')) {
      try {
        map.setLayoutProperty('route-xray-underpass', 'visibility', isUnderpass ? 'visible' : 'none');
      } catch (_e) {}
    }

    if (state.car3d) {
      state.car3d.updatePose({ underpassSeeThrough: isUnderpass });
    }

    updateElevationBadgeUi();
  }

  function evaluateElevationAndSeeThrough(_nowTs, forceImmediate = false) {
    const activeStep = state.routeModel
      ? Geo.getActiveRouteStep(state.routeModel, state.vehicle.routeDistKm)
      : null;

    const renderedFeatures =
      state.sim.forceUnderpassSeeThrough || !state.mapReady
        ? []
        : queryRenderedRoadFeaturesAtEgo(state.map, state.displayCoords);

    const res = Geo.classifyElevationState({
      modeId: state.mode,
      activeStep,
      renderedFeatures,
      forceUnderpass: state.sim.forceUnderpassSeeThrough,
    });

    const changed = res.state !== state.elevation.state;
    state.elevation.hasBridgeOverhead = res.hasBridgeOverhead;
    state.elevation.hasBridgeUnderEgo = res.hasBridgeUnderEgo;
    state.elevation.hasMotorwayUnderEgo = res.hasMotorwayUnderEgo;
    state.elevation.isHighwayRoute = res.isHighwayRoute;

    if (changed || forceImmediate) {
      state.elevation.state = res.state;
      applyElevationVisuals(res.state);
    }
  }

  function updateElevationBadgeUi() {
    const elev = state.elevation.state;
    dom.elevationStatusPill.classList.remove('hidden', 'elev-up', 'elev-under');
    if (elev === 'elevated') {
      dom.elevationStatusPill.classList.add('elev-up');
      dom.elevationStatusPill.textContent = '高架';
    } else if (elev === 'underpass') {
      dom.elevationStatusPill.classList.add('elev-under');
      dom.elevationStatusPill.textContent = '高架下 透過';
    } else {
      dom.elevationStatusPill.classList.add('hidden');
    }
  }

  function setForceUnderpassSeeThrough(enabled) {
    state.sim.forceUnderpassSeeThrough = Boolean(enabled);
    dom.toggleUnderpassSeeThrough.checked = state.sim.forceUnderpassSeeThrough;
    evaluateElevationAndSeeThrough(performance.now(), true);
    showToast(
      state.sim.forceUnderpassSeeThrough
        ? '高架下シースルー透過 ON（頭上高架半透明＋X-Ray有効）'
        : '高架下シースルー透過 OFF（自動判定へ復帰）',
      state.sim.forceUnderpassSeeThrough ? 'warn' : 'info',
      2400
    );
  }

  function setLightPreset(preset) {
    const allowed = new Set(['night', 'dusk', 'day']);
    if (!allowed.has(preset)) return;
    state.settings.lightPreset = preset;

    dom.lightPresetBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lightPreset === preset);
    });

    if (state.map && state.mapReady) {
      try {
        state.map.setConfigProperty('basemap', 'lightPreset', preset);
      } catch (_err) {}
    }

    const labelMap = { night: 'Night（夜間）', dusk: 'Dusk（夕暮れ）', day: 'Day（昼間）' };
    showToast(`ライトプリセット：${labelMap[preset]}`, 'info', 1800);
  }

  function setCarHeightOffset(meters) {
    const val = Geo.clamp(Math.round((Number(meters) || 0) * 2) / 2, -5, 20);
    state.settings.carHeightOffsetM = val;
    dom.sliderCarHeight.value = String(val);
    const sign = val > 0 ? '+' : '';
    dom.carHeightLabel.textContent = `${sign}${val.toFixed(1)} m`;

    if (state.car3d) {
      state.car3d.updatePose({ heightOffsetM: val });
    }
  }

  // =========================================================================
  // Mountain Mode Initial-D Curve HUD (500ms Throttle + 2.5s Lock)
  // =========================================================================
  function resetMountainCurveDisplay() {
    state.mountainCurve.lastEvalTs = 0;
    state.mountainCurve.lockedUntilTs = 0;
    state.mountainCurve.displayed = null;
    dom.initialdCurveCard.className = 'initiald-curve-card hidden';
  }

  function renderInitialDCurveCard(curve) {
    if (!curve) {
      dom.initialdCurveCard.className = 'initiald-curve-card hidden';
      return;
    }
    dom.initialdCurveCard.className = `initiald-curve-card tier-${curve.tier}`;
    dom.initialdArrowBox.innerHTML = getInitialDCurveSvg(curve);
    dom.initialdDirLabel.textContent = curve.dirEn;
    dom.initialdRankLabel.textContent = curve.tier;
  }

  function evaluateMountainCurveThrottled(nowTs, forceEval = false) {
    if (state.mode !== 'mountain' || !state.routeModel) {
      if (state.mountainCurve.displayed !== null) {
        resetMountainCurveDisplay();
      } else {
        dom.initialdCurveCard.classList.add('hidden');
      }
      return;
    }

    const mc = state.mountainCurve;
    if (!forceEval && nowTs - mc.lastEvalTs < mc.evalIntervalMs) {
      return;
    }
    mc.lastEvalTs = nowTs;

    if (!forceEval && mc.displayed && nowTs < mc.lockedUntilTs) {
      return;
    }

    const curve = Geo.analyzeMountainPaceNote(state.routeModel, state.vehicle.routeDistKm, {
      lookaheadMinMeters: CFG.modes.mountain.lookaheadMinMeters,
      lookaheadMaxMeters: CFG.modes.mountain.lookaheadMaxMeters,
    });

    if (curve) {
      mc.displayed = curve;
      mc.lockedUntilTs = nowTs + mc.lockDurationMs;
      renderInitialDCurveCard(curve);
    } else {
      mc.displayed = null;
      mc.lockedUntilTs = 0;
      renderInitialDCurveCard(null);
    }
  }

  // =========================================================================
  // 3-Mode Switching, Terrain & Continuous Smoothstep + 0.08 Damping Camera
  // =========================================================================
  function applyTerrainForMode(modeId) {
    const map = state.map;
    const modeCfg = CFG.modes[modeId];
    if (!map || !state.mapReady || !modeCfg) return;

    try {
      if (modeCfg.enableTerrain && map.getSource('mapbox-dem')) {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: modeCfg.terrainExaggeration });
      } else {
        map.setTerrain(null);
      }
    } catch (_err) {}
  }

  function updateModeButtonsUi(modeId) {
    const modeCfg = CFG.modes[modeId];
    dom.modeCycleIcon.innerHTML = getModeIconSvg(modeId);
    dom.modeCycleLabel.textContent = getModeBezelLabel(modeId);
    dom.btnModeCycle.classList.add('is-lit');
    dom.modeStatusPill.textContent = modeCfg.label;
  }

  function cycleDrivingMode() {
    const idx = MODE_ORDER.indexOf(state.mode);
    const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setDrivingMode(nextMode);
  }

  function setDrivingMode(modeId) {
    if (!CFG.modes[modeId]) return;
    state.mode = modeId;

    updateModeButtonsUi(modeId);
    applyTerrainForMode(modeId);
    evaluateContinuousCameraTarget();
    evaluateElevationAndSeeThrough(performance.now(), true);
    resetMountainCurveDisplay();
    evaluateMountainCurveThrottled(performance.now(), true);
    updateNavigationAnalytics();
    showToast(`${CFG.modes[modeId].label}モードに切替ました`, 'info', 1800);
  }

  function recordCameraSnapshot(coords, bearing, zoom, pitch, padTop) {
    state.cam.lastApplied = {
      lng: coords[0],
      lat: coords[1],
      bearing,
      zoom,
      pitch,
      padTop,
    };
  }

  function cameraHasChanged(coords, bearing, zoom, pitch, padTop) {
    const prev = state.cam.lastApplied;
    if (!prev) return true;
    return (
      Math.abs(coords[0] - prev.lng) > 1e-7 ||
      Math.abs(coords[1] - prev.lat) > 1e-7 ||
      Math.abs(Geo.angleDiff(prev.bearing, bearing)) > 0.05 ||
      Math.abs(zoom - prev.zoom) > 0.002 ||
      Math.abs(pitch - prev.pitch) > 0.03 ||
      padTop !== prev.padTop
    );
  }

  /**
   * 毎フレーム残距離から Smoothstep 目標 zoom / pitch を連続算出（段差・閾値ジャンプなし）
   */
  function evaluateContinuousCameraTarget() {
    const modeCfg = CFG.modes[state.mode];
    const evalRes = Geo.evaluateManeuverProximityZoom(
      state.routeModel,
      state.vehicle.coords,
      state.vehicle.routeDistKm,
      state.mode,
      state.sim.forceCloseZoom,
      modeCfg,
      state.vehicle.isSnappedToRoute
    );

    const prevApproaching = state.cam.isApproaching;
    const prevStepIdx = state.cam.approachStep ? state.cam.approachStep.index : -1;
    const nextStepIdx = evalRes.step ? evalRes.step.index : -1;

    state.cam.targetZoom = evalRes.targetZoom;
    state.cam.targetPitch = evalRes.targetPitch;
    state.cam.approachT = evalRes.approachT;
    state.cam.easedT = evalRes.easedT;
    state.cam.isApproaching = evalRes.active;
    state.cam.approachStep = evalRes.step;
    state.cam.lastManeuverDistM = evalRes.effectiveDistMeters;

    if (prevApproaching !== evalRes.active || prevStepIdx !== nextStepIdx) {
      updateJctBeaconOnMap(evalRes.active ? evalRes.step : null);
      refreshGuidanceUi();
    }
  }

  function setForceCloseZoom(enabled) {
    state.sim.forceCloseZoom = Boolean(enabled);
    dom.toggleForceCloseZoom.checked = state.sim.forceCloseZoom;
    if (state.sim.forceCloseZoom && !state.followCamera) {
      setFollowCamera(true);
    }
    evaluateContinuousCameraTarget();
    refreshGuidanceUi();
    showToast(
      state.sim.forceCloseZoom
        ? `強制3Dズーム ON（目標 Zoom ${state.cam.targetZoom.toFixed(1)} / Pitch ${Math.round(state.cam.targetPitch)}°）`
        : '強制3Dズーム OFF（距離連動補間へ復帰）',
      'info',
      2200
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
    dom.btnRecenter.classList.toggle('is-lit', enabled);
    dom.btnRecenter.classList.toggle('attention', !enabled);

    if (enabled && state.map && state.mapReady) {
      // Seed damped camera state from current viewport so recentering glides seamlessly via 0.08 damping
      const curCenter = state.map.getCenter();
      state.cam.center = [curCenter.lng, curCenter.lat];
      state.cam.bearing = Geo.normalizeBearing(state.map.getBearing());
      state.cam.zoom = state.map.getZoom();
      state.cam.pitch = state.map.getPitch();
      state.cam.lastApplied = null;
    }
  }

  // =========================================================================
  // Geocoding Search (Destination & Waypoint Add) + Map Tap Gestures
  // =========================================================================
  async function geocodePlaces(query) {
    const q = query.trim();
    if (!q || !state.accessToken) return [];

    const [lng, lat] = state.vehicle.coords;
    let items = [];

    try {
      const v5Url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
        `?language=ja&limit=5&proximity=${lng.toFixed(5)},${lat.toFixed(5)}` +
        `&access_token=${encodeURIComponent(state.accessToken)}`;
      const res = await fetch(v5Url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.features) && data.features.length > 0) {
          items = data.features.map((f) => ({
            name: f.text_ja || f.text || f.place_name_ja || f.place_name || q,
            address: f.place_name_ja || f.place_name || '',
            coords: f.center || (f.geometry && f.geometry.coordinates),
          }));
        }
      }
    } catch (_err) {}

    if (items.length === 0) {
      try {
        const v6Url =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodeURIComponent(q)}` +
          `&language=ja&limit=5&proximity=${lng.toFixed(5)},${lat.toFixed(5)}` +
          `&access_token=${encodeURIComponent(state.accessToken)}`;
        const res = await fetch(v6Url);
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

    return items.filter((it) => Array.isArray(it.coords) && it.coords.length >= 2);
  }

  async function searchDestinationPlaces(query) {
    if (!query.trim()) return;
    dom.searchResultsSection.classList.remove('hidden');
    dom.searchResultsList.innerHTML = '<div class="map-hint-note">検索中...</div>';

    const valid = await geocodePlaces(query);
    if (valid.length === 0) {
      dom.searchResultsList.innerHTML =
        '<div class="map-hint-note">候補が見つかりませんでした。別キーワードまたは「地図から選ぶ」をお試しください。</div>';
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
        state.waypoints = [];
        setDestinationAndFetchRoute(place.coords, place.name);
      });
      dom.searchResultsList.appendChild(btn);
    });
  }

  async function searchWaypointPlaces(query) {
    if (!query.trim()) return;
    if (!state.destination) {
      showToast('先に「目的地」を設定してください', 'warn');
      return;
    }
    dom.waypointResultsList.classList.remove('hidden');
    dom.waypointResultsList.innerHTML = '<div class="map-hint-note">経由地を検索中...</div>';

    const valid = await geocodePlaces(query);
    if (valid.length === 0) {
      dom.waypointResultsList.innerHTML =
        '<div class="map-hint-note">経由地の候補が見つかりませんでした。</div>';
      return;
    }

    dom.waypointResultsList.innerHTML = '';
    valid.forEach((place) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result-item';
      btn.innerHTML = `
        <div class="search-result-name"></div>
        <div class="search-result-addr"></div>
      `;
      btn.querySelector('.search-result-name').textContent = `+ 経由地に追加：${place.name}`;
      btn.querySelector('.search-result-addr').textContent = place.address || '日本';
      btn.addEventListener('click', async () => {
        state.waypoints.push({ name: place.name, coords: place.coords });
        dom.waypointSearchInput.value = '';
        dom.waypointResultsList.classList.add('hidden');
        dom.waypointResultsList.innerHTML = '';
        await recalculateActiveRoute(false);
      });
      dom.waypointResultsList.appendChild(btn);
    });
  }

  async function reverseGeocode(coords) {
    if (!state.accessToken) return `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`;
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords[0].toFixed(6)},${coords[1].toFixed(6)}.json` +
        `?language=ja&limit=1&access_token=${encodeURIComponent(state.accessToken)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const feat = data.features && data.features[0];
        if (feat) {
          return feat.text_ja || feat.text || feat.place_name_ja || feat.place_name || '選択した地点';
        }
      }
    } catch (_err) {}
    return `指定地点 (${coords[1].toFixed(4)}, ${coords[0].toFixed(4)})`;
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
        state.waypoints = [];
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
  // Mapbox Directions API (`mapbox/driving`) w/ Waypoints & Preference + turf.lineOffset(-3.5m)
  // =========================================================================
  async function fetchDirectionsRoute(points, preference = 'highway') {
    const coordStr = points
      .map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`)
      .join(';');
    const excludeParam = preference === 'local' ? '&exclude=motorway,toll' : '';
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
      `?steps=true&geometries=geojson&overview=full&annotations=distance,speed&language=ja` +
      `${excludeParam}&access_token=${encodeURIComponent(state.accessToken)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Directions HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error((data && data.message) || 'ルートが見つかりませんでした');
    }
    return data.routes[0];
  }

  async function setDestinationAndFetchRoute(
    destCoords,
    destName,
    customOrigin = null,
    originName = '現在地',
    closeMenuOnSuccess = true
  ) {
    if (!state.accessToken) {
      openTokenModal(true);
      return;
    }

    const originCoords = customOrigin ? [...customOrigin] : [...state.vehicle.coords];
    state.origin = { name: originName, coords: originCoords };
    state.destination = { name: destName, coords: [...destCoords] };

    await recalculateActiveRoute(closeMenuOnSuccess);
  }

  async function recalculateActiveRoute(closeMenuOnSuccess = true) {
    if (!state.destination) {
      showToast('先に目的地を設定してください', 'warn');
      return;
    }
    if (!state.accessToken) {
      openTokenModal(true);
      return;
    }

    const points = [
      state.origin.coords,
      ...state.waypoints.map((w) => w.coords),
      state.destination.coords,
    ];
    const prefLabel = state.routePreference === 'local' ? '一般道優先' : '高速優先';
    showToast(`ルートを検索中 (${prefLabel}): ${state.destination.name}`);

    try {
      const route = await fetchDirectionsRoute(points, state.routePreference);
      // turf.lineOffset(-3.5m) でルート座標自体を左側走行車線へシフトしてモデル生成
      const model = Geo.buildRouteModel(route, {
        leftLaneOffsetMeters: CFG.leftLaneOffsetMeters,
      });

      state.routeModel = model;
      state.vehicle.coords = [...model.coords[0]];
      state.vehicle.routeDistKm = 0;
      state.vehicle.isSnappedToRoute = true;
      state.vehicle.heading = Geo.getRouteHeadingAt(model, 0, 0.03);
      state.gps.lastValidHeading = state.vehicle.heading;
      state.displayCoords = [...state.vehicle.coords];
      state.displayHeading = state.vehicle.heading;
      state.cam.center = [...state.displayCoords];
      state.cam.bearing = state.displayHeading;
      state.cam.lastApplied = null;
      resetMountainCurveDisplay();

      updateDestinationAndWaypointMarkers();
      syncRouteSourcesToMap();
      setPinMode(false);
      clearPendingPin();
      if (closeMenuOnSuccess) {
        setMenuOpen(false);
      }
      dom.btnClearRoute.classList.remove('hidden');

      updateNavigationAnalytics();
      evaluateContinuousCameraTarget();
      evaluateElevationAndSeeThrough(performance.now(), true);
      evaluateMountainCurveThrottled(performance.now(), true);
      renderRouteTimeline();
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
    state.waypoints = [];
    state.navProgress = null;
    state.vehicle.routeDistKm = 0;
    state.vehicle.isSnappedToRoute = false;
    state.cam.isApproaching = false;
    state.cam.approachStep = null;
    state.cam.approachT = 0;
    state.cam.easedT = 0;
    state.cam.lastManeuverDistM = Infinity;
    resetMountainCurveDisplay();

    if (state.sim.demoMode) {
      state.sim.demoMode = false;
      dom.toggleDemoMode.checked = false;
      dom.demoActiveChip.classList.add('hidden');
    }

    updateDestinationAndWaypointMarkers();
    updateJctBeaconOnMap(null);
    syncRouteSourcesToMap();
    evaluateContinuousCameraTarget();
    evaluateElevationAndSeeThrough(performance.now(), true);
    renderRouteTimeline();
    setFollowCamera(true);
    refreshGuidanceUi();
    dom.btnClearRoute.classList.add('hidden');
    dom.routeDestName.textContent = 'ルート未設定';
    dom.routeEtaVal.textContent = '--';
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
    state.waypoints = [];
    setDrivingMode(preset.mode);
    state.sim.demoSpeedKmh = preset.defaultSpeedKmh;
    dom.sliderDemoSpeed.value = String(preset.defaultSpeedKmh);
    dom.demoSpeedLabel.textContent = `${preset.defaultSpeedKmh} km/h`;

    await setDestinationAndFetchRoute(
      preset.destination,
      preset.name,
      preset.origin,
      `${preset.badge}スタート地点`,
      true
    );

    if (autoStartDemo && state.routeModel) {
      state.sim.demoMode = true;
      dom.toggleDemoMode.checked = true;
      dom.demoActiveChip.classList.remove('hidden');
      state.vehicle.speedMps = preset.defaultSpeedKmh / 3.6;
      state.gps.lastValidSpeedMps = state.vehicle.speedMps;
      setFollowCamera(true);
      updateGpsStatusUi();
      showToast(`${preset.name} デモ走行を開始 (${preset.defaultSpeedKmh} km/h)`);
    }
  }

  function renderRouteTimeline() {
    dom.routeTimelineList.innerHTML = '';

    if (!state.destination || !state.routeModel) {
      dom.fsMenuRouteBadge.textContent = 'ルート未設定';
      dom.routeEditSummary.textContent = 'ルート未設定';
      dom.btnClearRoute.classList.add('hidden');
      dom.routeTimelineList.innerHTML =
        '<div class="map-hint-note">現在ルートが設定されていません。「目的地」タブから検索またはクイック目的地を選択してください。</div>';
      return;
    }

    const distStr = Geo.formatDistanceJa(state.routeModel.totalMeters);
    const durStr = Geo.formatDurationJa(state.routeModel.totalDurationSec);
    const prefTag = state.routePreference === 'local' ? '一般道優先' : '高速優先';
    dom.fsMenuRouteBadge.textContent = `${state.destination.name} · ${distStr}`;
    dom.routeEditSummary.textContent = `${distStr} / 約${durStr}（${prefTag}）`;
    dom.btnClearRoute.classList.remove('hidden');

    // Origin Row
    const originRow = document.createElement('div');
    originRow.className = 'route-stop-row';
    originRow.innerHTML = `
      <span class="stop-dot origin"></span>
      <div class="stop-info">
        <div class="stop-role">出発地 (Origin)</div>
        <div class="stop-name"></div>
      </div>
    `;
    originRow.querySelector('.stop-name').textContent = state.origin.name || '現在地';
    dom.routeTimelineList.appendChild(originRow);

    // Waypoints Rows
    state.waypoints.forEach((wp, idx) => {
      const wpRow = document.createElement('div');
      wpRow.className = 'route-stop-row';
      wpRow.innerHTML = `
        <span class="stop-dot waypoint"></span>
        <div class="stop-info">
          <div class="stop-role">経由地 ${idx + 1} (Waypoint)</div>
          <div class="stop-name"></div>
        </div>
        <button type="button" class="icon-btn btn-danger" aria-label="経由地を削除">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      `;
      wpRow.querySelector('.stop-name').textContent = wp.name;
      wpRow.querySelector('button').addEventListener('click', async () => {
        state.waypoints.splice(idx, 1);
        await recalculateActiveRoute(false);
      });
      dom.routeTimelineList.appendChild(wpRow);
    });

    // Destination Row
    const destRow = document.createElement('div');
    destRow.className = 'route-stop-row';
    destRow.innerHTML = `
      <span class="stop-dot dest"></span>
      <div class="stop-info">
        <div class="stop-role">目的地 (Destination)</div>
        <div class="stop-name"></div>
      </div>
    `;
    destRow.querySelector('.stop-name').textContent = state.destination.name;
    dom.routeTimelineList.appendChild(destRow);
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
      state.cam.center = [...state.displayCoords];
      state.cam.bearing = state.displayHeading;
      state.cam.lastApplied = null;
    }

    state.gps.lastValidHeading = state.vehicle.heading;

    if (finalSpeedMps * 3.6 >= 10 && state.menuOpen) {
      setMenuOpen(false);
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

    if (state.car3d) {
      state.car3d.updatePose({ isDeadReckoning: true });
    }

    updateGpsStatusUi();
    showToast(`自律航法（Dead Reckoning）へ切替：${reason}`, 'warn', 3000);
  }

  function exitDeadReckoning() {
    if (!state.gps.isDeadReckoning) return;
    state.gps.isDeadReckoning = false;
    state.gps.drMode = 'OFF';
    state.sim.lockedTunnelSpeedMps = null;
    if (state.car3d) {
      state.car3d.updatePose({ isDeadReckoning: false });
    }
    updateGpsStatusUi();
  }

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
  // Core 60fps Kinematic, WebGL 3D Car Pose & Smoothstep+Damping Camera Loop
  // =========================================================================
  function tickAnimationLoop(ts) {
    if (!state.lastFrameTs) state.lastFrameTs = ts;
    const dtSec = Math.min(0.15, Math.max(0.001, (ts - state.lastFrameTs) / 1000));
    state.lastFrameTs = ts;

    // 1. Kinematic step (Dead Reckoning OR Virtual Demo Drive along -3.5m left-lane route)
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
        updateGpsStatusUi();
        showToast('目的地に到着しました（デモ走行完了）', 'info', 3500);
      }

      updateNavigationAnalytics();
      if (ts - state.lastSliceUpdateTs > 140) {
        syncRouteSourcesToMap();
        state.lastSliceUpdateTs = ts;
      }
    }

    // 2. Smooth vehicle display pose interpolation
    const vehicleLerp = Math.min(1, dtSec * 12);
    state.displayCoords[0] += (state.vehicle.coords[0] - state.displayCoords[0]) * vehicleLerp;
    state.displayCoords[1] += (state.vehicle.coords[1] - state.displayCoords[1]) * vehicleLerp;
    state.displayHeading = Geo.lerpBearing(state.displayHeading, state.vehicle.heading, vehicleLerp);

    // 3. Per-frame continuous Smoothstep camera target, bridge hit-test & Mountain curve
    evaluateContinuousCameraTarget();
    evaluateElevationAndSeeThrough(ts, false);
    evaluateMountainCurveThrottled(ts, false);

    // 4. WebGL 3D Car Pose & Silky 0.08-Damped Camera Update
    if (state.map && state.mapReady) {
      const groundElev =
        (typeof state.map.queryTerrainElevation === 'function'
          ? state.map.queryTerrainElevation(state.displayCoords, { exaggerated: false })
          : 0) || 0;
      state.elevation.groundElevationM = groundElev;
      if (state.mode === 'mountain') {
        state.vehicle.altitudeM = Math.round(groundElev);
      }

      if (state.car3d) {
        state.car3d.updatePose({
          lng: state.displayCoords[0],
          lat: state.displayCoords[1],
          heading: state.displayHeading,
          heightOffsetM: state.settings.carHeightOffsetM,
          isDeadReckoning: state.gps.isDeadReckoning,
          underpassSeeThrough: state.elevation.state === 'underpass',
        });
      }

      if (state.followCamera) {
        // Continuous frame-rate-normalized damping (~0.08 per 60fps frame)
        const baseDamp = Number.isFinite(CFG.cameraDamping) ? CFG.cameraDamping : 0.08;
        const damp = 1 - Math.pow(1 - baseDamp, dtSec * 60);

        state.cam.zoom += (state.cam.targetZoom - state.cam.zoom) * damp;
        state.cam.pitch += (state.cam.targetPitch - state.cam.pitch) * damp;
        state.cam.bearing = Geo.lerpBearing(state.cam.bearing, state.displayHeading, damp);
        state.cam.center[0] += (state.displayCoords[0] - state.cam.center[0]) * damp;
        state.cam.center[1] += (state.displayCoords[1] - state.cam.center[1]) * damp;

        const pad = getCockpitPadding();
        if (
          cameraHasChanged(
            state.cam.center,
            state.cam.bearing,
            state.cam.zoom,
            state.cam.pitch,
            pad.top
          )
        ) {
          state.map.jumpTo({
            center: state.cam.center,
            bearing: state.cam.bearing,
            zoom: state.cam.zoom,
            pitch: state.cam.pitch,
            padding: pad,
          });
          recordCameraSnapshot(
            state.cam.center,
            state.cam.bearing,
            state.cam.zoom,
            state.cam.pitch,
            pad.top
          );
        }
      }
    }

    // 5. Instrument cluster & Settings telemetry readouts
    renderSpeedometerAndTelemetry();

    requestAnimationFrame(tickAnimationLoop);
  }

  // =========================================================================
  // Navigation Analytics & HUD Updates
  // =========================================================================
  function updateNavigationAnalytics() {
    if (!state.routeModel) {
      state.navProgress = null;
      refreshGuidanceUi();
      return;
    }

    state.navProgress = Geo.getNavigationProgress(state.routeModel, state.vehicle.routeDistKm);
    refreshGuidanceUi();
  }

  function renderSpeedometerAndTelemetry() {
    const speedKmh = Math.max(0, Math.round(state.vehicle.speedMps * 3.6));
    dom.speedValue.textContent = String(speedKmh);

    const ratio = Geo.clamp(speedKmh / 160, 0, 1);
    dom.speedBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;

    const hdg = Math.round(Geo.normalizeBearing(state.displayHeading))
      .toString()
      .padStart(3, '0');
    dom.headingVal.textContent = `${hdg}° ${Geo.bearingToCompass(state.displayHeading)}`;

    if (state.destination && state.navProgress) {
      dom.routeDestName.textContent = state.destination.name;
      dom.routeEtaVal.textContent = `${Geo.formatDistanceJa(state.navProgress.remainingMeters)} · ${Geo.formatDurationJa(state.navProgress.remainingSeconds)}`;
    } else {
      dom.routeDestName.textContent = 'ルート未設定';
      dom.routeEtaVal.textContent = '--';
    }

    if (state.menuOpen) {
      dom.dbgZoom.textContent = state.map
        ? state.map.getZoom().toFixed(2)
        : state.cam.zoom.toFixed(2);
      dom.dbgPitch.textContent = state.map
        ? `${state.map.getPitch().toFixed(1)}°`
        : `${state.cam.pitch.toFixed(1)}°`;
      dom.dbgApproach.textContent = state.cam.easedT.toFixed(2);
      const groundM = Math.round(state.elevation.groundElevationM || 0);
      dom.dbgElev.textContent = `${groundM}m`;
      const sign = state.settings.carHeightOffsetM > 0 ? '+' : '';
      dom.dbgCarZ.textContent = `${sign}${state.settings.carHeightOffsetM.toFixed(1)}m`;
      dom.dbgDrMode.textContent = state.gps.isDeadReckoning ? state.gps.drMode : 'OFF';
    }
  }

  function updateGpsStatusUi() {
    dom.gpsStatusPill.classList.remove('gps-online', 'gps-dr', 'gps-standby');

    if (state.gps.isDeadReckoning) {
      dom.gpsStatusPill.classList.add('gps-dr');
      dom.gpsPrimaryLabel.textContent = '自律航法';
      return;
    }

    if (state.sim.demoMode) {
      dom.gpsStatusPill.classList.add('gps-online');
      dom.gpsPrimaryLabel.textContent = 'SIM走行';
      return;
    }

    if (state.gps.hasFix) {
      dom.gpsStatusPill.classList.add('gps-online');
      dom.gpsPrimaryLabel.textContent = 'GPS';
      return;
    }

    dom.gpsStatusPill.classList.add('gps-standby');
    dom.gpsPrimaryLabel.textContent = 'GPS待機';
  }

  function refreshGuidanceUi() {
    const mode = state.mode;
    const nav = state.navProgress;

    if (!nav) {
      dom.maneuverIconBox.innerHTML = getManeuverSvg('straight');
      dom.guidanceDistance.textContent =
        mode === 'highway' ? '高速巡航' : mode === 'mountain' ? '山岳走行' : '案内待機';
      dom.guidanceTag.textContent =
        mode === 'highway' ? 'IC / JCT 監視' : mode === 'mountain' ? '3D地形・カーブ解析' : 'Standard 3D';
      dom.zoomActivePill.classList.toggle('hidden', !state.sim.forceCloseZoom);
      if (state.sim.forceCloseZoom) dom.zoomActivePill.textContent = '強制ZOOM';
      dom.guidanceInstruction.textContent = '左ベゼルのMENUまたはマップタップで目的地設定';
      return;
    }

    if (mode === 'highway') {
      const branch = state.cam.approachStep || nav.nextBranch;
      const distMeters = Number.isFinite(state.cam.lastManeuverDistM)
        ? state.cam.lastManeuverDistM
        : nav.distToBranchMeters;

      dom.maneuverIconBox.innerHTML = getManeuverSvg(branch.maneuverKey);
      dom.guidanceDistance.textContent = Geo.formatDistanceJa(distMeters);
      dom.guidanceTag.textContent = nav.isFallbackBranch ? '次の分岐' : branch.branchTag;
      dom.zoomActivePill.classList.toggle('hidden', !state.cam.isApproaching);
      dom.zoomActivePill.textContent = state.sim.forceCloseZoom ? '強制ZOOM' : 'JCT 3D';
      dom.guidanceInstruction.textContent = branch.title || branch.instruction;
      return;
    }

    const step = state.cam.approachStep || nav.nextStep;
    const distMeters =
      mode === 'city' && Number.isFinite(state.cam.lastManeuverDistM)
        ? state.cam.lastManeuverDistM
        : nav.distToStepMeters;

    dom.maneuverIconBox.innerHTML = getManeuverSvg(step.maneuverKey);
    dom.guidanceDistance.textContent = Geo.formatDistanceJa(distMeters);
    dom.guidanceTag.textContent =
      step.maneuver.type === 'arrive'
        ? '目的地'
        : mode === 'mountain'
        ? '次の案内'
        : '次の交差点';
    dom.zoomActivePill.classList.toggle('hidden', !state.cam.isApproaching);
    dom.zoomActivePill.textContent = state.sim.forceCloseZoom ? '強制ZOOM' : '交差点3D';
    dom.guidanceInstruction.textContent = step.instruction || step.title;
  }

  // =========================================================================
  // Full-Screen Automotive Menu Controller, Presets & Event Bindings
  // =========================================================================
  function setMenuOpen(open, tabName = null) {
    state.menuOpen = Boolean(open);
    dom.fullscreenMenu.classList.toggle('collapsed', !state.menuOpen);
    dom.btnMenuToggle.classList.toggle('is-lit', state.menuOpen);
    dom.btnMenuToggle.setAttribute('aria-expanded', String(state.menuOpen));
    if (state.menuOpen) {
      if (tabName) setMenuTab(tabName);
      renderRouteTimeline();
    }
  }

  function setMenuTab(tabName) {
    if (!dom.menuTabPanels[tabName]) return;
    state.activeMenuTab = tabName;

    dom.menuTabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    Object.entries(dom.menuTabPanels).forEach(([key, panel]) => {
      panel.classList.toggle('active', key === tabName);
    });

    if (tabName === 'route') {
      renderRouteTimeline();
    }
  }

  function setRoutePreference(pref) {
    if (pref !== 'highway' && pref !== 'local') return;
    state.routePreference = pref;
    dom.btnRoutePrefHighway.classList.toggle('active', pref === 'highway');
    dom.btnRoutePrefLocal.classList.toggle('active', pref === 'local');
  }

  function setPinMode(active) {
    state.pinModeActive = active;
    dom.btnMapPinMode.classList.toggle('active', active);
    if (state.map) {
      state.map.getCanvas().style.cursor = active ? 'crosshair' : '';
    }
    if (active) {
      setMenuOpen(false);
      showToast('マップ上の任意の場所をタップして目的地を設定できます');
    }
  }

  function renderPresetButtons(container) {
    container.innerHTML = '';
    CFG.demoPresets.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-card';
      btn.innerHTML = `
        <div class="preset-card-top">
          <span class="preset-name"></span>
          <span class="preset-badge"></span>
        </div>
        <div class="preset-desc"></div>
      `;
      btn.querySelector('.preset-name').textContent = preset.name;
      btn.querySelector('.preset-badge').textContent = preset.badge;
      btn.querySelector('.preset-desc').textContent = preset.desc;
      btn.addEventListener('click', () => loadDemoPreset(preset, true));
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
    // Left Black Hardware Bezel Touch Switches
    dom.btnModeCycle.addEventListener('click', cycleDrivingMode);
    dom.btnMenuToggle.addEventListener('click', () => setMenuOpen(!state.menuOpen));
    dom.btnRecenter.addEventListener('click', () => {
      if (state.menuOpen) setMenuOpen(false);
      setFollowCamera(true);
    });

    // Full-Screen Menu Header & Category Tabs
    dom.btnMenuClose.addEventListener('click', () => setMenuOpen(false));
    dom.menuTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => setMenuTab(btn.dataset.tab));
    });

    // Tab 1: Destination Search & Map Tap Mode
    dom.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchDestinationPlaces(dom.searchInput.value);
    });
    dom.btnMapPinMode.addEventListener('click', () => setPinMode(!state.pinModeActive));

    // Tab 2: Route Edit (Waypoints, Highway/Local Preference, Recalculate, Clear)
    dom.btnRoutePrefHighway.addEventListener('click', async () => {
      setRoutePreference('highway');
      if (state.destination) await recalculateActiveRoute(false);
    });
    dom.btnRoutePrefLocal.addEventListener('click', async () => {
      setRoutePreference('local');
      if (state.destination) await recalculateActiveRoute(false);
    });
    dom.btnRouteRecalc.addEventListener('click', () => recalculateActiveRoute(false));
    dom.waypointSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchWaypointPlaces(dom.waypointSearchInput.value);
    });
    dom.btnClearRoute.addEventListener('click', clearActiveRoute);

    // Pin Confirmation
    dom.btnPinRoute.addEventListener('click', () => {
      if (state.pendingPin) {
        state.waypoints = [];
        setDestinationAndFetchRoute(state.pendingPin.coords, state.pendingPin.name);
      }
    });
    dom.btnPinCancel.addEventListener('click', clearPendingPin);

    // Tab 3: Demo Drive & Speed Slider
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
        setMenuOpen(false);
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
      state.cam.center = [...state.displayCoords];
      state.cam.bearing = state.displayHeading;
      state.cam.lastApplied = null;
      resetMountainCurveDisplay();
      updateJctBeaconOnMap(null);
      syncRouteSourcesToMap();
      updateNavigationAnalytics();
      evaluateContinuousCameraTarget();
      evaluateElevationAndSeeThrough(performance.now(), true);
      evaluateMountainCurveThrottled(performance.now(), true);
      setFollowCamera(true);
      showToast('スタート地点へ戻しました');
    });

    // Tab 3: Vehicle Height Offset Fine-Tune Slider (-5m .. +20m)
    dom.sliderCarHeight.addEventListener('input', (e) => setCarHeightOffset(e.target.value));
    dom.btnCarHeightReset.addEventListener('click', () => {
      setCarHeightOffset(0);
      showToast('車両の高さオフセットを 0.0m へリセットしました');
    });

    // Tab 3: Day/Night Light Preset Selector (Night / Dusk / Day)
    dom.lightPresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => setLightPreset(btn.dataset.lightPreset));
    });

    // Tab 3: Underpass See-Through, Tunnel DR & Forced 3D Zoom Toggles
    dom.toggleUnderpassSeeThrough.addEventListener('change', () => {
      setForceUnderpassSeeThrough(dom.toggleUnderpassSeeThrough.checked);
    });
    dom.toggleForceCloseZoom.addEventListener('change', () => {
      setForceCloseZoom(dom.toggleForceCloseZoom.checked);
    });
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

    // Tab 3: System Utilities
    dom.btnWakelock.addEventListener('click', () => {
      if (state.wakeLock.sentinel) {
        releaseWakeLock();
      } else {
        requestWakeLock(false);
      }
    });
    dom.btnFullscreen.addEventListener('click', toggleFullscreenLandscape);
    dom.btnTokenSettings.addEventListener('click', () => {
      setMenuOpen(false);
      openTokenModal(Boolean(state.accessToken));
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

  // Read-only diagnostic hook for runtime inspection
  window.__AERO_NAVI__ = {
    getState: () => state,
    getMap: () => state.map,
    getCar3d: () => state.car3d,
    evaluateMountainCurve: (ts, force) => evaluateMountainCurveThrottled(ts, force),
    evaluateElevation: (ts, force) => evaluateElevationAndSeeThrough(ts, force),
    evaluateContinuousCamera: () => evaluateContinuousCameraTarget(),
  };

  // =========================================================================
  // Bootstrap
  // =========================================================================
  function init() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);

    updateModeButtonsUi(state.mode);
    renderPresetButtons(dom.presetList);
    renderRouteTimeline();
    setCarHeightOffset(0);
    bindUiEvents();
    updateGpsStatusUi();
    updateElevationBadgeUi();
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
