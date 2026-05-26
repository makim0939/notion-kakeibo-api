export const PAYMENT_METHODS = ["カード", "現金"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ExpenseRequest = {
	name: string;
	amount: number;
	paymentMethod: PaymentMethod;
	date: string;
	category?: string;
};
