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

  // Mapbox GL JS v3 Standard Style（立体交差・3D高架橋・車線・路面標示・3D建物を標準描画）
  mapStyle: 'mapbox://styles/mapbox/standard',

  // 初期位置（GPS未取得時のデフォルト：東京・渋谷駅付近）
  defaultCenter: [139.701636, 35.658034],
  defaultBearing: 35,

  // 走行モード別カメラ＆自動至近距離ズーム設定（バンパー／ドラレコ視点）
  modes: {
    city: {
      id: 'city',
      label: '市街地',
      code: 'CITY',
      baseZoom: 19.2,
      pitch: 75,
      // 交差点の右左折 150m 手前〜通過まで自動至近距離ズーム
      closeZoomTriggerMeters: 150,
      closeZoomReleaseMeters: 190,
      closeZoomPassClearMeters: -30,
      closeZoom: 20.3,
      closePitch: 80,
      enableTerrain: false,
      terrainExaggeration: 0,
    },
    highway: {
      id: 'highway',
      label: '高速道路',
      code: 'HWY',
      baseZoom: 16.8,
      pitch: 68,
      // JCT・IC・分岐 800m 手前〜通過まで自動至近距離ズーム
      closeZoomTriggerMeters: 800,
      closeZoomReleaseMeters: 920,
      closeZoomPassClearMeters: -45,
      closeZoom: 19.5,
      closePitch: 78,
      enableTerrain: false,
      terrainExaggeration: 0,
    },
    mountain: {
      id: 'mountain',
      label: '山',
      code: 'MTN',
      baseZoom: 18.2,
      pitch: 72,
      closeZoomTriggerMeters: 0,
      closeZoomReleaseMeters: 0,
      closeZoomPassClearMeters: -30,
      closeZoom: 19.5,
      closePitch: 78,
      enableTerrain: true,
      terrainExaggeration: 1.5,
      // ペースノート前方解析レンジ (m)
      lookaheadMinMeters: 100,
      lookaheadMaxMeters: 300,
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
      badge: '市街地',
      name: '渋谷駅 → 東京駅',
      desc: '交差点150m自動ズーム・車線＆3D建物確認',
      origin: [139.701636, 35.658034],
      destination: [139.767125, 35.681236],
      defaultSpeedKmh: 45,
    },
    {
      id: 'highway-shuto',
      mode: 'highway',
      badge: '高速・JCT',
      name: '芝公園(首都高) → 大黒PA',
      desc: 'JCT/IC 800m自動ズーム・3D立体交差確認',
      origin: [139.7495, 35.6542],
      destination: [139.6801, 35.4616],
      defaultSpeedKmh: 95,
    },
    {
      id: 'mountain-hakone',
      mode: 'mountain',
      badge: '山岳',
      name: '箱根ターンパイク → 大観山',
      desc: '3D地形・実ルート連動ペースノート確認',
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
