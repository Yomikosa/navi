# AERO-DRIVE 3D Cockpit Navigation

Mapbox GL JS v3（**Mapbox Standard Style**）、Three.js 3D 自車カスタムレイヤー、Mapbox Directions / Geocoding API、および Turf.js を用いた、純正車載デジタルコックピット風の 3D スマートフォン向けカーナビゲーション Web アプリです（横画面・ランドスケープ特化）。

## ライブデモ（GitHub Pages）

- **URL**: https://yomikosa.github.io/navi/
- アクセス後、Mapbox パブリックアクセストークン（`pk.ey...`）を入力するだけですぐに利用できます（トークンは端末のブラウザ `localStorage` にのみ保存されます）。

## Mapbox アクセストークンの設定方法

以下のいずれかの方法で設定できます：

1. **画面上のモーダルから入力（最も簡単）**
   デプロイ URL を開くと初期設定画面が表示されます。Mapbox のパブリックトークン（`pk.ey...`）を入力して「起動する」を押してください（右ドックの「メニュー」内にある `API KEY` ボタンからいつでも変更・削除可能）。
2. **ソースコードに直接記載**
   `js/config.js` 先頭の `MAPBOX_ACCESS_TOKEN` にトークンを設定します：
   ```js
   const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoi...';
   ```
3. **URL パラメータで渡す**
   `https://yomikosa.github.io/navi/?token=pk.ey...` で開くと自動で `localStorage` に保存され、アドレスバーからトークンを除去して起動します。

## 主な仕様・機能

- **Mapbox Standard Style v3 & 路面密着 3D 自車モデル**
  - `mapbox://styles/mapbox/standard` に `lightPreset: 'night'` と `show3dObjects: true` を適用し、立体交差・3D 高架橋・車線・路面標示・3D 建物を標準描画
  - 2D マーカーを廃止し、Three.js（Custom WebGL 3D Layer）による進行方向・Pitch 同期の 3D 車両モデルを配置。タイヤ接地面（底面 `Z=0`）原点＋ `map.queryTerrainElevation(lngLat, { exaggerated: false }) || 0` による厳密な路面接地を実現（不要な固定高さ加算なし）
  - 画面高さ 55% の `padding.top` を常時適用し、3D 自車を画面下部 1/4 に固定したバンパー／ドラレコ風の至近距離 3D 視点
- **高架下シースルー（半透明）化 ＆ 路面標示が透けるスリムルート**
  - 高架下走行時（およびメニュー内の「高架下シースルー強制 ON/OFF」時）に、頭上の高架レイヤー透過度低減（`0.22`）＋ Standard 3D 構造物の一時フラット化 ＋ X-Ray オクルージョン透過ルート＆3D 自車シルエットを描画
  - ルートラインは `slot: 'middle'`、`line-color: '#3b82f6'`、`line-opacity: 0.55`、`line-width: [14→4px, 18→10px, 20→18px]` で道路ポリゴン表面へそのまま密着描画し、白線・進行矢印・車線標示を隠さずに案内
- **3つの走行モード & 毎フレーム `turf.distance` 連動 自動 3D ズーム**
  1. **市街地モード (`CITY`)**: 通常 `Zoom 19.2 / Pitch 75°`。交差点の右左折 **150m 手前〜通過** で `Zoom 20.3 / Pitch 80°` に自動ズームイン
  2. **高速道路モード (`HIGHWAY`)**: 巡航 `Zoom 16.8 / Pitch 68°`。JCT・IC・分岐 **800m 手前〜通過** で `Zoom 19.5 / Pitch 78°` に自動ズームイン
  3. **山モード (`MOUNTAIN`)**: `Zoom 18.2 / Pitch 72°`、`mapbox-dem` 3D 地形有効（等倍 `exaggeration: 1.0` で3D自車と完全接地）。イニシャルDアーケード風の 4 段階シンプルカーブアイコン（`EASY` 20°〜45° / `MEDIUM` 45°〜80° / `HARD` 80°〜130° / `HAIRPIN` 130°以上）を 500ms スロットリング＋2.5秒間ロックでチラつきゼロ表示
- **左端・純正車載ナビ風ハードウェアベゼル ＆ 右端テスラ風統合パネル**
  - **画面左端（`64〜68px` 固定・`#08080a` フラット黒ベゼル）**: 静電タッチスイッチ風の枠なし発光アイコンで ①現在時刻（非ボタン） ②モード切替（`CITY → HIGHWAY → MOUNTAIN`） ③メニュー（ベゼルすぐ右隣からスライド展開） ④自車位置に戻る の 4 項目を配置
  - **画面右端（パターンB・テスラ風統合パネル）**: 速度計・走行状態バッジ・次の案内＆残り時間（ETA）を縦に統合し、左ベゼルと明確に左右分離
- **トンネル対応：ルートスナップ型 自律航法（Dead Reckoning）**
  - GPS 途絶・精度低下時に自律航法へ自動切替し、`turf.along` で実ルート上を滑らかに追従前進

## ファイル構成

```text
.
├── index.html          # コックピットHUD構造・Mapbox/Turf/Three.js読み込み
├── styles.css          # 左テスラパネル・右4項目スリムドック・イニシャルDカーブアイコンCSS
├── manifest.json       # PWA / フルスクリーン横画面設定
├── icons/icon.svg      # アプリアイコン
└── js/
    ├── config.js       # MAPBOX_ACCESS_TOKEN（先頭定義）・Standard設定・カメラプロファイル
    ├── geometry.js     # Turf.js 分岐距離計算・高架上/下判定・4段階曲率解析・自律航法エンジン
    ├── car3d-layer.js  # Three.js Custom WebGL 3D車両レイヤー（高度追従＋X-Ray透過対応）
    └── app.js          # Mapbox GL JS v3 Standard制御・シースルー管理・API通信・Geolocation・HUD
```
