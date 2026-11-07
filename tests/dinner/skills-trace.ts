// Post-build deployment check. Run after `npm run build`, without provider calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
test("production dinner route includes every on-demand skill markdown asset", () => {
  const trace = path.resolve(
    ".next/server/app/api/dinner/[[...path]]/route.js.nft.json",
  );
  const { files } = z
    .object({ files: z.array(z.string()) })
    .parse(JSON.parse(fs.readFileSync(trace, "utf8")));
  for (const name of ["room-status", "expense-preparation", "memory"]) {
    const entry = files.find((file) =>
      file.endsWith(`/skills/tab-dinner/${name}/SKILL.md`),
    );
    assert.ok(entry, `Missing deployed skill: ${name}`);
    assert.match(
      fs.readFileSync(path.resolve(path.dirname(trace), entry), "utf8"),
      /version: "1.0"/,
    );
  }
});
