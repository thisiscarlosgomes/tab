/** Runs matched browser experiments, retaining failures as comparison evidence. */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

async function main() {
  const roundsArg = process.argv.find((arg) => arg.startsWith("--rounds="));
  const rounds = Number(roundsArg?.split("=")[1] ?? 1);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5)
    throw new Error("Use 1–5 rounds");
  const only = process.argv
    .find((arg) => arg.startsWith("--approach="))
    ?.split("=")[1];
  if (only && !["pending", "current"].includes(only))
    throw new Error("Unknown approach");
  const batch = Date.now();
  const directory = `/tmp/tab-agent-comparison-${batch}`;
  await mkdir(directory, { recursive: true });
  const results: Record<string, unknown>[] = [];
  const scenarios = [
    { name: "short", flags: [] },
    { name: "history-gap", flags: ["--gap"] },
    { name: "odd-cents", flags: ["--odd"] },
  ];
  for (let round = 1; round <= rounds; round++)
    for (const [index, scenario] of scenarios.entries()) {
      // Alternate order to avoid always evaluating one variant first.
      for (const approach of only
        ? [only]
        : index % 2
          ? ["pending", "current"]
          : ["current", "pending"]) {
        const artifactName = `compare-${batch}-${round}-${scenario.name}-${approach}`;
        const args = [
          "--env-file=.env.local",
          "--import",
          "tsx",
          "tests/dinner/browser.ts",
          "--live",
          `--artifact-name=${artifactName}`,
          ...scenario.flags,
          ...(approach === "pending" ? ["--pending"] : ["--legacy"]),
          ...(process.argv.includes("--chrome") ? ["--chrome"] : []),
        ];
        console.log(`Running ${approach}: ${scenario.name}, round ${round}`);
        const started = performance.now();
        let output = "";
        const code = await new Promise<number>((resolve, reject) => {
          const child = spawn(process.execPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout.on("data", (data) => {
            output += data.toString();
          });
          child.stderr.on("data", (data) => {
            output += data.toString();
          });
          child.once("error", reject);
          child.once("exit", (code) => resolve(code ?? 1));
        });
        await writeFile(
          `${directory}/${round}-${scenario.name}-${approach}.log`,
          output,
        );
        let evidence: {
          timings?: { milliseconds: number }[];
          runs?: { tools: { name: string; outcome: string }[] }[];
          proposals?: unknown[];
          calls?: number;
          extractions?: number;
        } = {};
        try {
          evidence = JSON.parse(
            await readFile(
              `/tmp/tab-browser-${artifactName}/evidence.json`,
              "utf8",
            ),
          );
        } catch {
          /* The process may fail before browser startup. */
        }
        const result = {
          round,
          scenario: scenario.name,
          approach,
          passed: code === 0,
          exitCode: code,
          durationMs: Math.round(performance.now() - started),
          modelTurnMs: evidence.timings?.map((t) => t.milliseconds),
          calls: evidence.calls,
          extractions: evidence.extractions,
          proposalCount: evidence.proposals?.length,
          tools: evidence.runs?.flatMap((run) => run.tools),
          evidence: `/tmp/tab-browser-${artifactName}`,
          log: `${directory}/${round}-${scenario.name}-${approach}.log`,
        };
        results.push(result);
        console.log(
          `${code === 0 ? "PASS" : "FAIL"}: ${approach} / ${scenario.name}`,
        );
        await writeFile(
          `${directory}/results.json`,
          JSON.stringify({ batch, rounds, results }, null, 2),
        );
      }
    }
  const rows = results.map(
    (r) =>
      `| ${r.round} | ${r.scenario} | ${r.approach} | ${r.passed ? "Pass" : "Fail"} | ${r.calls ?? "—"} | ${r.proposalCount ?? "—"} |`,
  );
  await writeFile(
    `${directory}/report.md`,
    `# Isolated agent comparison\n\nSame configured model, real browser UI and server, actual receipt OCR, separate disposable databases. Auth and Next routing are test adapters. These are small-sample experiments, not reliability estimates.\n\n| Round | Scenario | Approach | Result | Model turns | Proposals |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n\nRaw logs, traces, transcripts and tool outcomes are linked in results.json. No real rooms were modified.\n`,
  );
  console.log(`Comparison report: ${directory}/report.md`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
