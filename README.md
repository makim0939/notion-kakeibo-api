# notion-kakeibo-api

iPhone ショートカットから支出を Notion に記録するための API（Cloudflare Workers + Hono）。
設計の背景は [docs/家計簿アプリNotion統合_システム設計書.md](docs/家計簿アプリNotion統合_システム設計書.md) を参照。

## セットアップ

```bash
npm install
```

秘匿値をローカル用に用意する。

```bash
cp .dev.vars.example .dev.vars
```

| 変数 | 置き場所 | 用途 |
| --- | --- | --- |
| `NOTION_API_KEY` | secret | Notion インテグレーショントークン |
| `API_KEY` | secret | このAPIを呼び出すための認証キー |
| `NOTION_DATABASE_ID` | `wrangler.jsonc` の vars | 支出を書き込む NotionDB のID |
| `NOTION_DATASOURCE_ID` | `wrangler.jsonc` の vars | 支出のデータソースID |
| `NOTION_SUMMARY_DATA_SOURCE_ID` | `wrangler.jsonc` の vars | 月次サマリのデータソースID |

本番の secret は wrangler で登録する。

```bash
npx wrangler secret put API_KEY
```

## 開発

```bash
npm run dev
```

```bash
npm run typecheck
```

```bash
npm run check
```

`main` への push で [GitHub Actions](.github/workflows/deploy.yaml) が型チェック・フォーマットチェックを通してからデプロイする。

## 認証

`/` と `/health` 以外のエンドポイントは API キーが必要。次のどちらかで渡す。

- `X-API-Key: <API_KEY>`
- `Authorization: Bearer <API_KEY>`

キーが一致しない場合は `401`、サーバ側に `API_KEY` が設定されていない場合は `500` を返す（設定漏れのまま公開されるのを防ぐため）。

```bash
curl -X POST https://<worker>/expenses \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"ローソン 昼ごはん","amount":820,"paymentMethod":"カード","date":"2026-08-21"}'
```

## エンドポイント

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| `GET` | `/health` | 不要 | 疎通確認。`{ "status": "ok" }` |
| `POST` | `/expenses` | 必要 | 支出を1件登録する |

## エラーレスポンス

```json
{
  "success": false,
  "code": "unauthorized",
  "message": "認証に失敗しました。",
  "requestId": "9baff8f9-7f5b-4428-93d0-d5c0954d477c"
}
```

| ステータス | `code` | 内容 |
| --- | --- | --- |
| 401 | `unauthorized` | API キーが不正 |
| 404 | `not_found` | 該当するエンドポイントがない |
| 500 | `server_misconfigured` | サーバ側に `API_KEY` が未設定 |
| 500 | `internal_error` | 想定外のエラー |
| 502 | `notion_error` | Notion API との連携に失敗 |
| 503 | `notion_error` | Notion API のレート制限・タイムアウト（時間をおいて再試行） |

`requestId` はレスポンスヘッダ `X-Request-Id` と同じ値で、ログの突き合わせに使える。
Notion のエラーメッセージはログにのみ残し、レスポンスには `notionCode` だけを載せている。

Notion 呼び出しは SDK の設定で 10 秒タイムアウト・最大2回リトライにしている。
SDK は 429 と冪等なメソッドの 5xx のみを `Retry-After` 準拠で再送するため、支出登録の POST が二重に走ることはない。
