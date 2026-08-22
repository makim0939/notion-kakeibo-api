export type Bindings = {
	/** Notion のインテグレーショントークン。`wrangler secret put NOTION_API_KEY` で設定する。 */
	NOTION_API_KEY: string;
	NOTION_DATABASE_ID: string;
	NOTION_DATASOURCE_ID: string;
	NOTION_SUMMARY_DATA_SOURCE_ID: string;
	/**
	 * このAPIを呼び出すための認証キー。`wrangler secret put API_KEY` で設定する。
	 * 未設定の場合、保護されたエンドポイントは 500 を返す（誤って全公開されるのを防ぐため）。
	 */
	API_KEY: string;
};

export type Variables = {
	/** リクエストごとに払い出す識別子。ログとレスポンスの突き合わせに使う。 */
	requestId: string;
};

export type AppEnv = {
	Bindings: Bindings;
	Variables: Variables;
};
