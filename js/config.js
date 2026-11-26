/**
 * ============================================================================
 * MAPBOX ACCESS TOKEN 設定
 * ----------------------------------------------------------------------------
 * コードに直接設定する場合は、下の MAPBOX_ACCESS_TOKEN に
 * Mapbox のパブリックアクセストークン (pk.eyJ...) を入力してください。
 * 空欄のままデプロイした場合でも、アプリ起動時のトークン入力画面（localStorage保存）
 * または URL パラメータ (?token=pk.eyJ...) から即座に設定して利用できます。
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

  // 日本の左側走行車線オフセット（turf.lineOffset でルート座標自体を左へ 3.5m シフト）
  leftLaneOffsetMeters: -3.5,

  // カメラ連続ダンピング係数（毎フレーム current += (target - current) * 0.08 相当）
  cameraDamping: 0.08,

  // 走行モード別カメラ＆距離連動 Smoothstep 連続補間設定
  modes: {
    city: {
      id: 'city',
      label: '市街地',
      code: 'CITY',
      baseZoom: 19.2,
      pitch: 75,
      // 交差点の右左折 250m → 30m の間で連続的にズームイン
      approachStartMeters: 250,
      approachEndMeters: 30,
      closeZoomPassClearMeters: -25,
      closeZoom: 20.4,
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
      // JCT・IC・分岐 1000m → 150m の間で連続的にズームイン
      approachStartMeters: 1000,
      approachEndMeters: 150,
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
      approachStartMeters: 0,
      approachEndMeters: 0,
      closeZoomPassClearMeters: -30,
      closeZoom: 19.5,
      closePitch: 78,
      enableTerrain: true,
      terrainExaggeration: 1.0,
      // 山モード ペースノート前方解析レンジ (100m〜250m)
      lookaheadMinMeters: 100,
      lookaheadMaxMeters: 250,
    },
  },

  // GPS / 自律航法（Dead Reckoning）しきい値
  gps: {
    signalTimeoutMs: 4500,      // この時間GPS更新が途絶えると自動で自律航法へ切替
    poorAccuracyMeters: 85,     // 精度低下(m)でトンネル/遮蔽と判定
    routeSnapThresholdM: 65,    // ルートからこの距離以内ならルートスナップ有効
    minHeadingSpeedMps: 1.2,    // 位置差分から方位を算出する最小速度
  },

  // 全画面メニュー「目的地」タブのワンタップ クイック目的地プリセット（4大スポット）
  demoPresets: [
    {
      id: 'city-tokyo-station',
      mode: 'city',
      badge: '市街地',
      name: '東京駅（丸の内）',
      desc: '渋谷駅→東京駅 · 交差点250m→30m連続ズーム',
      origin: [139.701636, 35.658034],
      destination: [139.767125, 35.681236],
      defaultSpeedKmh: 45,
    },
    {
      id: 'city-shibuya-scramble',
      mode: 'city',
      badge: '市街地 3D',
      name: '渋谷スクランブル交差点',
      desc: '表参道→渋谷 · 高密度3D建物＆左車線確認',
      origin: [139.7126, 35.6652],
      destination: [139.700571, 35.659482],
      defaultSpeedKmh: 40,
    },
    {
      id: 'highway-ohashi-jct',
      mode: 'highway',
      badge: '高速・JCT',
      name: '首都高・大橋JCT',
      desc: '渋谷入口→大橋JCT→用賀 · 3D立体交差＆1000m連続ズーム',
      origin: [139.7062, 35.6584],
      destination: [139.6318, 35.6277],
      defaultSpeedKmh: 85,
    },
    {
      id: 'mountain-hakone',
      mode: 'mountain',
      badge: '山岳',
      name: '箱根ターンパイク（大観山）',
      desc: '早川→大観山 · 3D地形＆イニシャルD風カーブ案内',
      origin: [139.1367, 35.2374],
      destination: [139.0488, 35.1842],
      defaultSpeedKmh: 65,
    },
  ],
};

if (typeof window !== 'undefined') {
  window.MAPBOX_ACCESS_TOKEN = MAPBOX_ACCESS_TOKEN;
  window.APP_CONFIG = APP_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAPBOX_ACCESS_TOKEN, APP_CONFIG };
}
