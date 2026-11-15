import { writeFileSync } from "node:fs";
import { observeModelCalls } from "./model-telemetry";
const observer = observeModelCalls();
process.on("exit", () => {
  if (process.env.TAB_BENCH_TELEMETRY_FILE) writeFileSync(process.env.TAB_BENCH_TELEMETRY_FILE, JSON.stringify(observer.calls, null, 2));
});
