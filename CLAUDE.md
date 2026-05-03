# hiragajan-pwa

iPhone PWA。**ひらがジャン** = ひらがな麻雀の2人対戦プロトタイプ。
彼女とスマホで遊ぶ用。

## ユーザー
日本語。非エンジニア。
危険操作以外は確認なしで進めてOK。

## 構成
- 素のHTML/CSS/JS (フレームワークなし)
- Vercel自動デプロイ (予定)
- データ: ローカルメモリのみ (永続化なし、対戦中のみ)
- 通信: **PeerJS** (P2P・公開ブローカー)
- ローカル開発: `python3 -m http.server 3337 --directory public`

## ファイル
- `public/index.html` - シェル + PeerJS CDN読み込み
- `public/js/app.js` - 全機能 (ゲーム + 通信)
- `public/css/style.css` - スタイル
- `public/sw.js` - Service Worker
- `public/manifest.json` - PWA設定

## ゲームルール (現状: 簡略七対子)
- 牌: ひらがな23字 × 4 = 92枚
- 配牌: 各プレイヤー7枚
- 手番: ツモ(8枚) → あがりチェック → 揃わなければ1枚捨てて7枚
- 上がり条件: **8枚で4組ペア** (同字4枚は2ペア扱い)
- 流局: 山がなくなったら引き分け
- 先攻: ホスト (ルーム作成側)

## 通信フロー
1. ホスト: `Peer('hiragajan-XXXXXX')` でブローカーに登録、6桁コードを表示
2. ゲスト: コード入力 → `peer.connect('hiragajan-XXXXXX')` で接続
3. 接続確立後ホストが配牌 → `init` メッセージで相手の手牌+山を送信
4. 以降、`draw` / `discard` / `win` / `draw_game` などのメッセージで状態同期

## デプロイ手順 (まだ未設定)
1. GitHub に新規リポジトリ作成 (例: `nobobo0530-create/hiragajan-pwa`)
2. `git remote add origin git@github.com:nobobo0530-create/hiragajan-pwa.git`
3. `git push -u origin main`
4. Vercel で GitHub 連携・自動デプロイ設定

## 今後の拡張予定 (ユーザー要望)
- 正式なルール再現 (面子・順子・役)
- デザイン強化 (麻雀牌風グラフィック)
- 対戦履歴
- スタンプ機能

## 既知の注意点
- PeerJS の公開ブローカーは無料・公開で稼働するが SLA なし
- 同一の RoomID が衝突する可能性あり (確率は低いが注意)
- iOS PWA でプライベートブラウジング使用時は localStorage 系が制限される
- 接続中にどちらかがブラウザを閉じると即切断
