# AERO-DRIVE 3D Cockpit Navigation

Mapbox GL JS v3（**Mapbox Standard Style**）、Mapbox Directions / Geocoding API、および Turf.js を用いた、純正車載デジタルコックピット風の 3D スマートフォン向けカーナビゲーション Web アプリです（横画面・ランドスケープ特化）。

## ライブデモ（GitHub Pages）

- **URL**: https://yomikosa.github.io/navi/
- アクセス後、Mapbox パブリックアクセストークン（`pk.ey...`）を入力するだけですぐに利用できます（トークンは端末のブラウザ `localStorage` にのみ保存されます）。

## Mapbox アクセストークンの設定方法

以下のいずれかの方法で設定できます：

1. **画面上のモーダルから入力（最も簡単）**
   デプロイ URL を開くと初期設定画面が表示されます。Mapbox のパブリックトークン（`pk.ey...`）を入力して「起動する」を押してください（左ベゼルの `MENU` 内にある `API KEY` ボタンからいつでも変更・削除可能）。
2. **ソースコードに直接記載**
   `js/config.js` 先頭の `MAPBOX_ACCESS_TOKEN` にトークンを設定します：
   ```js
   const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoi...';
   ```
3. **URL パラメータで渡す**
   `https://yomikosa.github.io/navi/?token=pk.ey...` で開くと自動で `localStorage` に保存され、アドレスバーからトークンを除去して起動します。

## 主な仕様・機能

- **Mapbox GL JS v3 ネイティブ描画による完全路面接地（ズレゼロ）**
  - `mapbox://styles/mapbox/standard` に `lightPreset: 'night'` と `show3dObjects: true` を適用し、立体交差・3D 高架橋・車線・路面標示・3D 建物を標準描画
  - Three.js 等の独自 Z 軸計算を廃止し、`mapboxgl.Marker`（`pitchAlignment: 'map'`, `rotationAlignment: 'map'`）による高精細 3D パース付き車両オブジェクトを採用。ズームや Pitch 変更時でも Mapbox 内部の地形・道路座標系に完全同期して浮き・沈みを排除
  - 毎フレーム自車座標に対して `map.queryRenderedFeatures(map.project(lngLat))` を実行し、直下の `structure === 'bridge'` や `class === 'motorway'` とルート属性から高架上／高架下をリアルタイム判定
- **日本の左側走行車線オフセット ＆ 高架上スナップ／高架下シースルー**
  - 全ルートレイヤーに `'line-offset': ['interpolate', ['linear'], ['zoom'], 14, -2, 18, -6, 20, -12]`、`'line-width': [14→4, 18→10, 20→18]`、`'line-opacity': 0.55`、`slot: 'middle'` を適用し、自車も同量左車線へオフセットして日本の左側車線中央を正確に走行
  - **高架区間走行時**: `slot: 'top'` の高架上面オーバーレイ（`route-elevated-top`）を自動有効化し、3D 高架ポリゴン上にルート線と自車を確実に表示
  - **高架下走行時**: 頭上の 3D 高架オブジェクト（`show3dObjects: false`）および高架レイヤー透過度低減（`0.22`）＋ X-Ray 透過ルートで下道の左車線と自車を視認確保（メニュー内に強制 ON/OFF トグル搭載）
- **3つの走行モード & 毎フレーム `turf.distance` 連動 自動 3D ズーム**
  1. **市街地モード (`CITY`)**: 通常 `Zoom 19.2 / Pitch 75°`。交差点の右左折 **150m 手前〜通過** で `Zoom 20.3 / Pitch 80°` に自動ズームイン
  2. **高速道路モード (`HIGHWAY`)**: 巡航 `Zoom 16.8 / Pitch 68°`。JCT・IC・分岐 **800m 手前〜通過** で `Zoom 19.5 / Pitch 78°` に自動ズームイン
  3. **山モード (`MOUNTAIN`)**: `Zoom 18.2 / Pitch 72°`、`mapbox-dem` 3D 地形有効。イニシャルDアーケード風の 4 段階シンプルカーブアイコン（`EASY` 20°〜45° / `MEDIUM` 45°〜80° / `HARD` 80°〜130° / `HAIRPIN` 130°以上）を 500ms スロットリング＋2.5秒間ロックでチラつきゼロ表示
- **左端・純正車載ナビ風ハードウェアベゼル ＆ 右端テスラ風統合パネル**
  - **画面左端（`64〜68px` 固定・`#08080a` フラット黒ベゼル）**: 静電タッチスイッチ風の枠なし発光アイコンで ①現在時刻（非ボタン） ②モード切替（`CITY → HIGHWAY → MOUNTAIN`） ③メニュー（ベゼルすぐ右隣からスライド展開） ④自車位置に戻る の 4 項目を配置
  - **画面右端（パターンB・テスラ風統合パネル）**: 速度計・走行状態バッジ・次の案内＆残り時間（ETA）を縦に統合し、左ベゼルと明確に左右分離
- **トンネル対応：ルートスナップ型 自律航法（Dead Reckoning）**
  - GPS 途絶・精度低下時に自律航法へ自動切替し、`turf.along` で実ルート上を滑らかに追従前進

## ファイル構成

```text
.
├── index.html          # コックピットHUD構造・Mapbox/Turf読み込み
├── styles.css          # 左黒ハードウェアベゼル・右テスラパネル・ネイティブ3D自車CSS
├── manifest.json       # PWA / フルスクリーン横画面設定
├── icons/icon.svg      # アプリアイコン
└── js/
    ├── config.js       # MAPBOX_ACCESS_TOKEN（先頭定義）・Standard設定・カメラプロファイル
    ├── geometry.js     # Turf.js 左車線オフセット・分岐距離計算・高架判定・4段階曲率解析・自律航法
    └── app.js          # Mapbox GL JS v3 Standard制御・ネイティブ3D自車・高架上/下オーバーレイ・HUD
```
