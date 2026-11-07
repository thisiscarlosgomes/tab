import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
export const skillName = z.enum([
  "room-status",
  "expense-preparation",
  "memory",
]);
export const skillCatalog = [
  {
    name: "room-status",
    version: "1.1",
    description: "Room/personal obligation status and summaries",
  },
  {
    name: "expense-preparation",
    version: "1.1",
    description: "Prepare a proposed split for human review",
  },
  {
    name: "memory",
    version: "1.0",
    description: "Explicit preference and shared-note boundaries",
  },
];
const readers = {
  "room-status": () =>
    fs.readFileSync(
      path.join(process.cwd(), "skills/tab-dinner/room-status/SKILL.md"),
      "utf8",
    ),
  "expense-preparation": () =>
    fs.readFileSync(
      path.join(
        process.cwd(),
        "skills/tab-dinner/expense-preparation/SKILL.md",
      ),
      "utf8",
    ),
  memory: () =>
    fs.readFileSync(
      path.join(process.cwd(), "skills/tab-dinner/memory/SKILL.md"),
      "utf8",
    ),
};
export async function loadSkill(input: unknown) {
  return readers[skillName.parse(input)]();
}
