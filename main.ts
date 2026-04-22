import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { ensureLagoMetricSafety } from "./src/services/lago-safety.service.ts";

export const app = new App<State>();

app.use(staticFiles());

// Include file-system based routes here
app.fsRoutes();

// Phase D: verify Lago billable metric aggregation type on web-app startup.
// Fire-and-forget — never blocks serving.
ensureLagoMetricSafety().catch(() => {/* already logged */});
