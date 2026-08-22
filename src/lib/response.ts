export type ErrorBody = {
	success: false;
	/** 機械判定用のエラーコード。 */
	code: string;
	/** 人が読むメッセージ。クライアント側の表示にそのまま使える。 */
	message: string;
	requestId: string;
};

export function buildErrorBody(code: string, message: string, requestId: string): ErrorBody {
	return { success: false, code, message, requestId };
}
