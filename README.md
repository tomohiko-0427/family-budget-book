# 家計簿アプリ

## プロジェクト概要
- **名前**: 家計簿アプリ
- **目的**: シンプルで使いやすい家計簿アプリで、収入と支出を記録・管理
- **主な機能**: 
  - 収入・支出の記録
  - カテゴリー別分類
  - 月別フィルタリング
  - 収支サマリー表示
  - 取引履歴の削除

## URL
- **開発環境**: https://3000-ienkttsugveysqcyvceq5-de59bda9.sandbox.novita.ai
- **GitHub**: https://github.com/tomohiko-0427/family-budget-book

## 現在完成している機能
✅ カテゴリー管理
- 収入カテゴリー: 給料、副業、その他収入
- 支出カテゴリー: 食費、交通費、娯楽、光熱費、家賃、通信費、医療費、その他支出

✅ 取引記録
- 収入・支出の新規作成
- カテゴリー選択
- 金額入力
- 日付指定
- メモ記入

✅ データ表示
- 月別フィルタリング
- 取引履歴一覧表示
- 収入・支出・残高のサマリー表示

✅ データ操作
- 取引の削除機能

## 機能APIエンドポイント

### カテゴリー関連
- `GET /api/categories` - カテゴリー一覧取得

### 取引関連
- `GET /api/transactions?month=YYYY-MM` - 取引一覧取得（月別フィルタ可）
- `POST /api/transactions` - 新規取引作成
  - リクエストボディ: `{ type, amount, category_id, description, date }`
- `DELETE /api/transactions/:id` - 取引削除

### サマリー関連
- `GET /api/summary?month=YYYY-MM` - 収支サマリー取得（月別フィルタ可）
  - レスポンス: `{ income, expense, balance }`

## データアーキテクチャ
- **データモデル**: 
  - `categories` テーブル: カテゴリー情報（id, name, type, icon）
  - `transactions` テーブル: 取引情報（id, type, amount, category_id, description, date）
- **ストレージサービス**: Cloudflare D1（SQLite）
- **データフロー**: 
  1. フロントエンド → Hono API → D1データベース
  2. データ作成・取得・削除の標準CRUD操作

## 使い方
1. アプリを開くと、今月のデータが表示されます
2. 「新しい取引を追加」セクションで：
   - 種類（収入/支出）を選択
   - 金額を入力
   - カテゴリーを選択
   - 日付を指定
   - 必要に応じてメモを記入
   - 「保存」ボタンをクリック
3. 月選択で過去の履歴を表示可能
4. 取引履歴のゴミ箱アイコンで削除可能
5. サマリーカードで収支状況を一目で確認

## デプロイ
- **プラットフォーム**: Cloudflare Pages
- **ステータス**: ✅ ローカル開発環境で動作中
- **技術スタック**: 
  - バックエンド: Hono + TypeScript
  - フロントエンド: TailwindCSS + Vanilla JavaScript
  - データベース: Cloudflare D1 (SQLite)
  - デプロイ: Cloudflare Pages (準備完了)
- **最終更新**: 2026-01-26

## ローカル開発

### 環境構築
```bash
cd /home/user/webapp
npm install
```

### データベース初期化
```bash
npm run db:migrate:local
```

### 開発サーバー起動
```bash
# ビルド
npm run build

# PM2で起動
pm2 start ecosystem.config.cjs

# または直接起動
npm run dev:sandbox
```

### ポートクリーンアップ
```bash
npm run clean-port
```

## 今後の推奨開発項目
1. **データの可視化**
   - 月別チャート表示
   - カテゴリー別円グラフ
   - 期間比較機能

2. **データエクスポート**
   - CSV形式でのエクスポート機能
   - PDF形式でのレポート生成

3. **予算管理**
   - カテゴリー別予算設定
   - 予算超過アラート

4. **検索・フィルタ機能**
   - キーワード検索
   - 金額範囲フィルタ
   - 複数カテゴリー選択

5. **ユーザー認証**
   - ログイン機能
   - ユーザーごとのデータ管理

6. **レスポンシブ改善**
   - モバイル表示の最適化
   - タブレット対応

## プロジェクト構成
```
webapp/
├── src/
│   └── index.tsx          # メインアプリケーション（API + フロントエンド）
├── migrations/
│   └── 0001_initial_schema.sql  # データベースマイグレーション
├── dist/                  # ビルド出力
├── ecosystem.config.cjs   # PM2設定
├── wrangler.jsonc         # Cloudflare設定
├── package.json           # 依存関係とスクリプト
└── README.md             # このファイル
```

## ライセンス
MIT
