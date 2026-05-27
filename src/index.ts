import { Hono } from "hono";
import type { Bindings } from "./env";
import { expensesRoute } from "./routes/expenses";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
	return c.text("OK");
});

app.route("/expenses", expensesRoute);

export default app;
