# AERO-DRIVE 3D Cockpit Navigation

Mapbox GL JS v3（**Mapbox Standard Style**）、**Three.js WebGL 3D 自車モデル**、Mapbox Directions / Geocoding API、および Turf.js を用いた、純正車載デジタルコックピット風の 3D スマートフォン向けカーナビゲーション Web アプリです（横画面・ランドスケープ特化）。

## ライブデモ（GitHub Pages）

- **URL**: https://yomikosa.github.io/navi/
- アクセス後、Mapbox パブリックアクセストークン（`pk.ey...`）を入力するだけですぐに利用できます（トークンは端末のブラウザ `localStorage` にのみ保存されます）。

## Mapbox アクセストークンの設定方法

以下のいずれかの方法で設定できます：

1. **画面上のモーダルから入力（最も簡単）**
   デプロイ URL を開くと初期設定画面が表示されます。Mapbox のパブリックトークン（`pk.ey...`）を入力して「起動する」を押してください（左ベゼルの `MENU` → `設定・システム` 内にある `API KEY` ボタンからいつでも変更・削除可能）。
2. **ソースコードに直接記載**
   `js/config.js` 先頭の `MAPBOX_ACCESS_TOKEN` にトークンを設定します：
   ```js
   const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoi...';
   ```
3. **URL パラメータで渡す**
   `https://yomikosa.github.io/navi/?token=pk.ey...` で開くと自動で `localStorage` に保存され、アドレスバーからトークンを除去して起動します。

## 主な仕様・機能

- **WebGL 3D 空間内の立体 3D 自車（Three.js CustomLayer）＆ 正確な路面接地**
  - `mapbox://styles/mapbox/standard`（`show3dObjects: true`・Night / Dusk / Day ライトプリセット切替対応）上に、Three.js の 3D スポーツセダン（`js/car3d-layer.js`）を直接 WebGL 描画
  - `THREE.Box3` により 3D 車体のタイヤ接地面（底面）をローカル座標 `Y=0`（路面 `Z=0`）に厳密クランプし、`map.queryTerrainElevation(lngLat, { exaggerated: false }) || 0` の実標高へ接地
  - 設定タブに **「車両の高さ（Z座標）微調整スライダー（-5.0m 〜 +20.0m / 0m リセット）」** を搭載し、高架上や立体交差での手動接地調整に対応
- **`turf.lineOffset(-3.5m)` による日本の左側走行車線ルート ＆ 高架上／高架下シースルー**
  - Directions API で取得したルートジオメトリ自体を直後に `turf.lineOffset(routeFeature, -3.5, { units: 'meters' })` で左へ 3.5m シフトし、ルートリボンと 3D 自車の両方が日本の左側走行車線上を自然に追従
  - **高架上走行時**: `slot: 'top'` の高架上面オーバーレイ（`route-elevated-top`）を自動有効化
  - **高架下走行時**: 毎フレーム `map.queryRenderedFeatures` による高架判定と連動し、頭上高架の半透明化（`show3dObjects: false`・高架レイヤー透過度 `0.22`）＋ X-Ray 透過ルート＆3D 自車シルエットを表示
- **距離連動 Smoothstep 連続補間 ＆ `0.08` ダンピング・カメラ追従**
  - 閾値による急なカメラジャンプを廃止し、残距離から Smoothstep（`t²(3 - 2t)`）で目標 Zoom / Pitch を連続算出し、毎フレームダンピング係数 `0.08`（60fps 基準）で `zoom`・`pitch`・`bearing`・`center` を超滑らかに追従
  - **市街地モード (`CITY`)**: `250m` 以上で `Zoom 19.2 / Pitch 75°` → `250m 〜 30m` にかけて連続的に `Zoom 20.4 / Pitch 80°` へシームレス接近
  - **高速道路モード (`HIGHWAY`)**: `1000m` 以上で `Zoom 16.8 / Pitch 68°` → `1000m 〜 150m` にかけて連続的に `Zoom 19.5 / Pitch 78°` へシームレス接近
  - **山モード (`MOUNTAIN`)**: `Zoom 18.2 / Pitch 72°`、`mapbox-dem` 3D 地形有効。イニシャルDアーケード風の 4 段階シンプルカーブアイコン（`EASY` / `MEDIUM` / `HARD` / `HAIRPIN`）を 500ms スロットリング＋2.5秒間ロックで表示
- **左端・純正車載ナビ風ハードウェアベゼル ＆ 全画面車載ナビメニュー ＆ 右端テスラ風パネル**
  - **画面左端（`64〜68px` 固定・`#08080a` フラット黒ベゼル）**: ①現在時刻 ②モード切替（`CITY → HIGHWAY → MOUNTAIN`） ③全画面メニュー ④現在地 の 4 項目を配置
  - **全画面車載ナビメニュー（3カテゴリータブ + 右上 `× 地図へ戻る`）**:
    1. **【目的地】**: Mapbox Geocoding キーワード検索、「地図から選ぶ」マップタップ設定、4 つのクイック目的地プリセット（東京駅／渋谷スクランブル交差点／首都高・大橋JCT／箱根ターンパイク）
    2. **【ルート編集】**: 出発地・経由地・目的地タイムライン、「経由地を追加」（複数区間ルート探索）・個別削除、「高速道路 優先 / 一般道 優先（有料回避 `&exclude=motorway,toll`）」切替＆再検索、ルート消去
    3. **【設定・システム】**: デモ走行 ON/OFF・速度スライダー、車両の高さ（Z座標）微調整スライダー（`-5m 〜 +20m`）、トンネル GPS ロスト（自律航法）、高架下シースルー、強制 3D ズーム、昼夜ライトプリセット切替（`Night` / `Dusk` / `Day`）、Wake Lock・全画面・API KEY・リアルタイムテレメトリ
  - **画面右端（テスラ風統合パネル）**: 速度計・走行ステータス・次のナビ案内＆ETA を縦に統合
- **トンネル対応：ルートスナップ型 自律航法（Dead Reckoning）**
  - GPS 途絶・精度低下時に自律航法へ自動切替し、`turf.along` で左車線シフト済みルート上を滑らかに追従前進

## ファイル構成

```text
.
├── index.html          # コックピットHUD・左ベゼル・全画面3タブ車載メニュー・Mapbox/Turf/Three.js読込
├── styles.css          # 左黒ハードウェアベゼル・右テスラパネル・全画面車載メニューCSS
├── manifest.json       # PWA / フルスクリーン横画面設定
├── icons/icon.svg      # アプリアイコン
└── js/
    ├── config.js       # MAPBOX_ACCESS_TOKEN（先頭定義）・Standard設定・連続カメラ設定・4プリセット
    ├── geometry.js     # turf.lineOffset(-3.5m)・Smoothstep連続カメラ補間・高架判定・4段階曲率解析・自律航法
    ├── car3d-layer.js  # Three.js WebGL 3D立体車両CustomLayer（タイヤ底面Z=0固定・高さ微調整・X-Ray対応）
    └── app.js          # Mapbox GL JS v3 Standard制御・0.08ダンピングカメラ・全画面メニュー・複数経由地ルート
```
