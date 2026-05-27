import { Hono } from "hono";
import type { Bindings } from "./env";
import { expensesRoute } from "./routes/expenses";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
	return c.text("OK");
});

app.route("/expenses", expensesRoute);

app.onError((err, c) => {
	return c.json(
		{
			success: false,
			message: err.message,
		},
		500,
	);
});
export default app;
