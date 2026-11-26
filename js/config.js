/**
 * ============================================================================
 * MAPBOX ACCESS TOKEN 設定
 * ----------------------------------------------------------------------------
 * コードに直接設定する場合は、下の MAPBOX_ACCESS_TOKEN に
 * Mapbox のパブリックアクセストークン (pk.ey...) を入力してください。
 * 空欄のままデプロイした場合でも、アプリ起動時のトークン入力画面（localStorage保存）
 * または URL パラメータ (?token=pk.ey...) から即座に設定して利用できます。
 * ============================================================================
 */
const MAPBOX_ACCESS_TOKEN = '';

/**
 * アプリケーション全体の構成定数
 */
const APP_CONFIG = {
  tokenStorageKey: 'aero_drive_mapbox_token_v1',

  // Mapbox GL JS v3 ダークナビゲーションスタイル（道路・JCT視認性が高くcomposite建物レイヤー対応）
  mapStyle: 'mapbox://styles/mapbox/navigation-night-v1',

  // 初期位置（GPS未取得時のデフォルト：東京・渋谷駅付近）
  defaultCenter: [139.701636, 35.658034],
  defaultBearing: 35,

  // 走行モード別カメラ＆レイヤープロファイル
  modes: {
    city: {
      id: 'city',
      label: '市街地',
      code: 'CITY',
      zoomMin: 17.0,
      zoomMax: 18.0,
      baseZoom: 17.5,
      pitch: 65,
      show3dBuildings: true,
      enableTerrain: false,
      terrainExaggeration: 0,
      fogHorizon: '#071422',
      fogHigh: '#030812',
    },
    highway: {
      id: 'highway',
      label: '高速道路',
      code: 'HWY',
      zoomMin: 14.0,
      zoomMax: 15.0,
      baseZoom: 14.8,
      pitch: 55,
      show3dBuildings: false,
      enableTerrain: false,
      terrainExaggeration: 0,
      // JCT / IC 分岐 1.0km 以下での自動 3D ズーム設定
      jctTriggerMeters: 1000,
      jctReleaseMeters: 1180,
      jctPassClearMeters: -45,
      jctZoom: 17.5,
      jctPitch: 70,
      fogHorizon: '#07111f',
      fogHigh: '#02060d',
    },
    mountain: {
      id: 'mountain',
      label: '山',
      code: 'MTN',
      zoomMin: 15.4,
      zoomMax: 16.4,
      baseZoom: 15.8,
      pitch: 68,
      show3dBuildings: false,
      enableTerrain: true,
      terrainExaggeration: 1.5,
      // ペースノート前方解析レンジ (m)
      lookaheadMinMeters: 100,
      lookaheadMaxMeters: 300,
      fogHorizon: '#0b1826',
      fogHigh: '#03070e',
    },
  },

  // GPS / 自律航法（Dead Reckoning）しきい値
  gps: {
    signalTimeoutMs: 4500,      // この時間GPS更新が途絶えると自動で自律航法へ切替
    poorAccuracyMeters: 85,     // 精度低下(m)でトンネル/遮蔽と判定
    routeSnapThresholdM: 65,    // ルートからこの距離以内ならルートスナップ有効
    minHeadingSpeedMps: 1.2,    // 位置差分から方位を算出する最小速度
  },

  // ワンタップで全モードの実ルート動作を検証できるデモコース
  demoPresets: [
    {
      id: 'city-tokyo',
      mode: 'city',
      badge: '市街地 3D',
      name: '渋谷駅 → 東京駅',
      desc: '都心3Dビル群・右左折ガイド検証',
      origin: [139.701636, 35.658034],
      destination: [139.767125, 35.681236],
      defaultSpeedKmh: 45,
    },
    {
      id: 'highway-shuto',
      mode: 'highway',
      badge: '高速・JCT',
      name: '芝公園(首都高) → 大黒PA',
      desc: 'IC/JCT残距離・1km自動3Dズーム検証',
      origin: [139.7495, 35.6542],
      destination: [139.6801, 35.4616],
      defaultSpeedKmh: 95,
    },
    {
      id: 'mountain-hakone',
      mode: 'mountain',
      badge: '山岳・R案内',
      name: '箱根ターンパイク → 大観山',
      desc: '3D地形・実ルート連動ペースノート検証',
      origin: [139.1367, 35.2374],
      destination: [139.0488, 35.1842],
      defaultSpeedKmh: 65,
    },
  ],
};

// ブラウザグローバルおよび Node.js テスト環境互換エクスポート
if (typeof window !== 'undefined') {
  window.MAPBOX_ACCESS_TOKEN = MAPBOX_ACCESS_TOKEN;
  window.APP_CONFIG = APP_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAPBOX_ACCESS_TOKEN, APP_CONFIG };
}
