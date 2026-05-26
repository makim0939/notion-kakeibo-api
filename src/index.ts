import { Hono } from "hono";
import { expensesRoute } from "./routes/expenses";
import type { Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
	return c.text("OK");
});

app.route("/expenses", expensesRoute);

export default app;
