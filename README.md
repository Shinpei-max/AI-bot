# 勉強Bot

AIを使って学習内容を要約・整理し、Notionに自動記録するアプリです。

## 必要なもの

- [Node.js](https://nodejs.org/) (v18以上)
- Anthropic APIキー
- Notion APIキー + Notion データベース

## セットアップ手順

### 1. リポジトリをクローン

```bash
git clone <リポジトリのURL>
cd study-bot
```

### 2. パッケージをインストール

```bash
npm install
```

### 3. `.env.local` ファイルを作成

プロジェクトのルートに `.env.local` というファイルを作成し、以下を記入してください。

```
ANTHROPIC_API_KEY=your_anthropic_api_key
NOTION_API_KEY=your_notion_api_key
NOTION_DATABASE_ID=your_notion_database_id
```

#### 各キーの取得方法

- **ANTHROPIC_API_KEY**: [Anthropic Console](https://console.anthropic.com/) でAPIキーを発行
- **NOTION_API_KEY**: [Notion Integrations](https://www.notion.so/my-integrations) でインテグレーションを作成してキーを取得
- **NOTION_DATABASE_ID**: 使用するNotionデータベースのURLから取得（`notion.so/xxxxxxxx...` の英数字部分）

### 4. Notion データベースの準備

Notionに以下のプロパティを持つデータベースを作成し、インテグレーションを接続してください。

| プロパティ名 | 種類 |
|------------|------|
| タイトル | タイトル |
| 日付 | 日付 |
| 要約 | テキスト |
| タグ | マルチセレクト |
| 活用業種 | マルチセレクト |
| 習熟レベル | マルチセレクト |
| 重要な学び | テキスト |

### 5. アプリを起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。
