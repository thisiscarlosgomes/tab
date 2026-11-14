/** Test-only API usage observer. Does not alter requests, prompts, or production code. */
export type ApiCall = { model: string; status: number; milliseconds: number; input: number; cached: number; output: number; reasoning: number; error?: string };
type UsageResponse = {
  response?: UsageResponse;
  model?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number;
    input_tokens_details?: { cached_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};
export function observeModelCalls() {
  const original = globalThis.fetch;
  const calls: ApiCall[] = [];
  const pending: Promise<void>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.openai.com/")) return original(input, init);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const started = performance.now();
    const response = await original(input, init);
    const call: ApiCall = { model: body.model ?? "unknown", status: response.status, milliseconds: 0, input: 0, cached: 0, output: 0, reasoning: 0 };
    calls.push(call);
    pending.push(response.clone().text().then(text => {
      const records: UsageResponse[] = [];
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        for (const line of text.split("\n")) if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try { records.push(JSON.parse(line.slice(6))); } catch { /* ignore incomplete framing */ }
        }
      } else { try { records.push(JSON.parse(text)); } catch { /* preserve status */ } }
      for (const record of records) {
        const r = record.response ?? record;
        if (r.usage) {
          call.model = r.model ?? call.model;
          call.input = r.usage.input_tokens ?? r.usage.prompt_tokens ?? 0;
          call.cached = r.usage.input_tokens_details?.cached_tokens ?? r.usage.prompt_tokens_details?.cached_tokens ?? 0;
          call.output = r.usage.output_tokens ?? r.usage.completion_tokens ?? 0;
          call.reasoning = r.usage.output_tokens_details?.reasoning_tokens ?? 0;
        }
        if (r.error) call.error = String(r.error.message ?? r.error);
      }
      call.milliseconds = Math.round(performance.now() - started);
    }).catch(error => { call.error = String(error); }));
    return response;
  };
  return { calls, async flush() { await Promise.all(pending); }, close() { globalThis.fetch = original; } };
}
