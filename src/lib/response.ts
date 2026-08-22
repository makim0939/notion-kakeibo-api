import type { ZodError } from "zod";

export type FieldError = {
	field: string;
	message: string;
};

export type ErrorBody = {
	success: false;
	/** 機械判定用のエラーコード。 */
	code: string;
	/** 人が読むメッセージ。クライアント側の表示にそのまま使える。 */
	message: string;
	requestId: string;
	/** バリデーションエラーの詳細。該当しない場合は省略。 */
	errors?: FieldError[];
};

export function buildErrorBody(code: string, message: string, requestId: string, errors?: FieldError[]): ErrorBody {
	return errors && errors.length > 0
		? { success: false, code, message, requestId, errors }
		: { success: false, code, message, requestId };
}

/** Zod のエラーをフィールド単位のリストに変換する。 */
export function toFieldErrors(error: ZodError): FieldError[] {
	return error.issues.map((issue) => ({
		field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
		message: issue.message,
	}));
}
