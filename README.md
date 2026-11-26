# AERO-DRIVE 3D HUD Navi

Mapbox GL JS v3、Mapbox Directions / Search Box / Geocoding API、および Turf.js を用いた、最新自動運転車のデジタルコックピット風 3D スマートフォン向けカーナビゲーション Web アプリです（横画面・ランドスケープ特化）。

## ライブデモ（GitHub Pages）

- **URL**: https://yomikosa.github.io/navi/
- アクセス後、Mapbox パブリックアクセストークン（`pk.ey...`）を入力するだけですぐに利用できます（トークンは端末のブラウザ `localStorage` にのみ保存されます）。

## Mapbox アクセストークンの設定方法

以下のいずれかの方法で設定できます：

1. **画面上のモーダルから入力（最も簡単）**
   デプロイURLを開くと初期設定画面が表示されます。Mapbox のパブリックトークン（`pk.ey...`）を入力して「コックピットを起動」を押してください（右上の `KEY` ボタンからいつでも変更・削除可能）。
2. **ソースコードに直接記載**
   `js/config.js` 先頭の `MAPBOX_ACCESS_TOKEN` にトークンを設定します：
   ```js
   const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoi...';
   ```
3. **URL パラメータで渡す**
   `https://yomikosa.github.io/navi/?token=pk.ey...` で開くと自動で `localStorage` に保存され、アドレスバーからトークンを除去して起動します。

## 主な機能

- **ランドスケープ特化 3D HUD コックピット**
  - 進行方向が常に上（Heading-Up）・前方を見渡す Pitch 55°〜70° の 3D マップ
  - 大型デジタルスピードメーター（SVG アークゲージ・km/h・方位・標高表示）
  - Screen Wake Lock API による画面スリープ防止（フォアグラウンド復帰時に自動再取得）
  - 走行開始時に自動折りたたみ可能な目的地検索パネル
- **実ルート検索＆3D 発光パス描画**
  - Mapbox Search Box API（POI・住所対応、Geocoding API v6 フォールバック付き）およびマップ長押し／タップで目的地設定
  - Mapbox Directions API（`driving-traffic` / `driving`, `geometries=geojson&steps=true&overview=full&annotations=distance,speed`）で実ルートを取得し、自動運転パス風のシアン発光 3D ラインとして描画
- **3つの走行モード**
  1. **市街地モード (`CITY`)**: Zoom 17〜18 / Pitch 65°、半透明センサー風の 3D 建物レイヤー（`fill-extrusion`）表示、次の右左折ガイド
  2. **高速道路モード (`HIGHWAY`)**: 通常巡航 Zoom 14〜15（速度連動） / Pitch 55° / 3D 建物非表示。IC・JCT 分岐残距離カウントダウンパネルを表示し、**残距離 1.0km 以下**になると自動的に近距離 3D 視点（Zoom 17.5 / Pitch 70° / 3D 建物＆分岐強調）へ `easeTo` トランジション、通過後は広域視点に自動復帰
  3. **山モード (`MOUNTAIN`)**: Mapbox 3D 地形（`mapbox-dem`）＋陰影起伏を有効化。Turf.js で前方 100m〜300m の実ルート曲率（方位角差分・推定曲率半径）をリアルタイム計算し、`150m先 右急カーブ（R3）` / `左ヘアピン注意（R1）` 等のラリー風ペースノートを自動ポップアップ表示
- **トンネル対応：ルートスナップ型 自律航法（Dead Reckoning）**
  - Geolocation API の更新途絶・精度低下を検知すると自動的に `DEAD RECKONING（自律航法中）` へ切替
  - 直前の有効速度をもとに、`turf.along` で実ルートライン上へスナップさせて前進（トンネル内のカーブにも対応）。ルート未設定時は `turf.destination` で直前の進行方向へ直進推定
- **室内テスト用デバッグ＆シミュレーター（右上 `SIM` ボタン）**
  - 実ルート仮想走行デモの ON/OFF ＆ 仮想スピードスライダー（0〜150 km/h）
  - トンネル進入（GPS ロスト）トグルスイッチ
  - ワンタップで全3モードを検証できるデモコース（渋谷→東京駅 / 首都高芝公園→大黒PA / 箱根ターンパイク→大観山）

## ファイル構成

```text
.
├── index.html          # コックピットHUD構造・CDN読み込み
├── styles.css          # OLEDダークHUD・ランドスケープ最適化CSS
├── manifest.json       # PWA / フルスクリーン横画面設定
├── icons/icon.svg      # アプリアイコン
└── js/
    ├── config.js       # MAPBOX_ACCESS_TOKEN（先頭定義）・モード設定・デモコース
    ├── geometry.js     # Turf.js 幾何学・曲率ペースノート・JCT判定・自律航法エンジン
    └── app.js          # Mapbox GL JS v3 制御・API通信・Geolocation・Wake Lock・HUD更新
```

## 将来的な Android APK 化について

ビルド不要の純粋な HTML / CSS / JavaScript + PWA（`manifest.json`）構成のため、以下いずれの方法でもそのまま APK 化できます：

- **Capacitor**: `npx cap init` → `webDir: "."` → `npx cap add android` → Geolocation / KeepAwake プラグイン連携
- **TWA (Bubblewrap)**: GitHub Pages の HTTPS URL と `manifest.json` からそのまま Google Play 向け Android アプリを生成
