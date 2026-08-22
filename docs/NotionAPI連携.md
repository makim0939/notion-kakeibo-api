# Notion API 連携

Notion 呼び出しは SDK の設定で 10 秒タイムアウト・最大2回リトライにしている。
SDK は 429 と冪等なメソッドの 5xx のみを `Retry-After` 準拠で再送するため、支出登録の POST が二重に走ることはない。
