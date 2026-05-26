import { z } from "zod";
import { PAYMENT_METHODS } from "../types/expense";

export const expenseSchema = z.object({
	name: z.string().trim().min(1, "name is required"),

	amount: z.number().positive("amount must be greater than 0"),

	paymentMethod: z.enum(PAYMENT_METHODS),

	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),

	category: z.string().optional(),
});
