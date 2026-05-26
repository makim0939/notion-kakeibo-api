import { Hono } from "hono";
import { expenseSchema } from "../validators/expense";
import { decideCategory } from "../services/category";
import { createExpensePage } from "../services/notion";
import type { Bindings } from "../env";

export const expensesRoute = new Hono<{ Bindings: Bindings }>();

expensesRoute.post("/", async (c) => {
	try {
		const body = await c.req.json();
		const parsed = expenseSchema.safeParse(body);

		if (!parsed.success) {
			return c.json(
				{
					success: false,
					message: parsed.error.issues[0]?.message,
				},
				400,
			);
		}

		const expense = parsed.data;

		const category = expense.category ?? decideCategory(expense.name);

		const notionPage = await createExpensePage(
			{
				...expense,
				category,
			},
			c.env,
		);

		return c.json({
			success: true,
			pageId: notionPage.id,
			category,
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				message:
					error instanceof Error ? error.message : "Internal Server Error",
			},
			500,
		);
	}
});
