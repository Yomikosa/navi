# AERO-DRIVE 3D Cockpit Navigation

Mapbox GL JS v3（**Mapbox Standard Style**）、Mapbox Directions / Search Box / Geocoding API、および Turf.js を用いた、純正車載デジタルコックピット風の 3D スマートフォン向けカーナビゲーション Web アプリです（横画面・ランドスケープ特化）。

## ライブデモ（GitHub Pages）

- **URL**: https://yomikosa.github.io/navi/
- アクセス後、Mapbox パブリックアクセストークン（`pk.ey...`）を入力するだけですぐに利用できます（トークンは端末のブラウザ `localStorage` にのみ保存されます）。

## Mapbox アクセストークンの設定方法

以下のいずれかの方法で設定できます：

1. **画面上のモーダルから入力（最も簡単）**
   デプロイ URL を開くと初期設定画面が表示されます。Mapbox のパブリックトークン（`pk.ey...`）を入力して「起動する」を押してください（右上の `KEY` ボタンからいつでも変更・削除可能）。
2. **ソースコードに直接記載**
   `js/config.js` 先頭の `MAPBOX_ACCESS_TOKEN` にトークンを設定します：
   ```js
   const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoi...';
   ```
3. **URL パラメータで渡す**
   `https://yomikosa.github.io/navi/?token=pk.ey...` で開くと自動で `localStorage` に保存され、アドレスバーからトークンを除去して起動します。

## 主な仕様・機能

- **Mapbox Standard Style v3 によるリアルな 3D 道路表現**
  - `mapbox://styles/mapbox/standard` に `lightPreset: 'night'` と `show3dObjects: true` を適用し、立体交差・3D 高架橋・車線・路面標示・3D 建物を標準描画
  - 画面高さ 55% の `padding.top` を常時適用し、自車を画面下部 1/4 に固定したバンパー／ドラレコ風の至近距離 3D 視点
- **純正車載メーター風のミニマル UI**
  - `Inter` + 日本語サンセリフ（数字は `tabular-nums`）
  - 半透明すりガラスパネル（`rgba(15, 15, 20, 0.75)` + `backdrop-filter: blur(16px)` + `1px solid rgba(255,255,255,0.12)`）と統一されたナビブルー（`#2563eb` / `#3b82f6`）
  - Screen Wake Lock API による画面スリープ防止、走行時の検索パネル自動折りたたみ
- **3つの走行モード & 毎フレーム `turf.distance` 連動 自動 3D ズーム**
  1. **市街地モード (`City`)**: 通常 `Zoom 19.2 / Pitch 75°`。交差点の右左折 **150m 手前〜通過** で `Zoom 20.3 / Pitch 80°` に自動ズームイン
  2. **高速道路モード (`Highway`)**: 巡航 `Zoom 16.8 / Pitch 68°`。JCT・IC・分岐 **800m 手前〜通過** で `Zoom 19.5 / Pitch 78°` に自動ズームインし立体交差を拡大表示
  3. **山モード (`Mountain`)**: `Zoom 18.2 / Pitch 72°`、`mapbox-dem` 3D 地形有効。Turf.js による前方 100m〜300m 実ルート曲率解析でラリー風ペースノート（`R1` ヘアピン〜`R4` 中カーブ）を自動表示
- **トンネル対応：ルートスナップ型 自律航法（Dead Reckoning）**
  - GPS 途絶・精度低下時に `DEAD RECKONING（自律航法中）` へ自動切替し、`turf.along` で実ルートライン上へスナップ前進（ルート未設定時は `turf.destination` 直進推定）
- **デバッグ＆シミュレーター（右上 `SIM` ボタン）**
  - 実ルート仮想走行デモ ON/OFF ＆ 仮想スピードスライダー（0〜150 km/h）
  - **交差点 / JCT 至近距離カメラ強制確認ボタン**（即座に `easeTo` で至近距離 3D 視点を確認可能）
  - トンネル進入（GPS ロスト）トグルスイッチ、全3モードのワンタップテストコース

## ファイル構成

```text
.
├── index.html          # コックピットHUD構造・CDN読み込み
├── styles.css          # 純正車載ミニマルHUD・ランドスケープ最適化CSS
├── manifest.json       # PWA / フルスクリーン横画面設定
├── icons/icon.svg      # アプリアイコン
└── js/
    ├── config.js       # MAPBOX_ACCESS_TOKEN（先頭定義）・Standard設定・カメラプロファイル
    ├── geometry.js     # Turf.js 毎フレーム分岐距離計算・曲率ペースノート・自律航法エンジン
    └── app.js          # Mapbox GL JS v3 Standard制御・API通信・Geolocation・Wake Lock・HUD
```
