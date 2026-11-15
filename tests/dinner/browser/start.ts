import { loadEnvConfig } from "@next/env";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { DinnerService } from "../../../src/lib/dinner/service";
import { MongoRoomStore } from "../../../src/lib/dinner/mongo-store";
async function main() {
  const live = process.argv.includes("--live");
  if (live) {
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
    if (!process.env.OPENAI_API_KEY)
      throw new Error("Live lab needs OPENAI_API_KEY");
  }
  const mongo = await MongoMemoryServer.create({
    instance: { args: ["--wiredTigerCacheSizeGB", "0.25"] },
  });
  const client = await MongoClient.connect(mongo.getUri());
  const service = new DinnerService(
    new MongoRoomStore(client.db("tab_browser_fixture")),
  );
  const sessions = (
    live
      ? [
          "Carlos",
          "Maya · agent",
          "Leo · agent",
          "Nina · agent",
          "Owen · agent",
        ]
      : ["Alice", "Bob", "Carol"]
  ).map((name) => ({
    token: randomBytes(24).toString("hex"),
    actor: { id: randomUUID(), name, twitterSubject: null },
  }));
  const room = await service.create(sessions[0].actor, {
    clientId: randomUUID(),
    name: live ? "Live Plans Lab" : "Browser dinner",
    purpose: live
      ? "Carlos + four AI test participants · isolated live planning"
      : "Disposable planning verification",
  });
  for (const member of sessions.slice(1)) {
    const invite = await service.invite(room.id, sessions[0].actor, {
      clientId: randomUUID(),
    });
    await service.respond(member.actor, { token: invite.token }, "accepted");
  }
  await client.close();
  const child = spawn(
    process.execPath,
    [
      path.resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.TAB_BROWSER_PORT ?? (live ? "3108" : "3107"),
    ],
    {
      cwd: path.resolve("tests/dinner/browser"),
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        ...(live
          ? {
              OPENAI_API_KEY: process.env.OPENAI_API_KEY,
              OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL,
              TAB_LIVE_LAB: "1",
              TAB_LIVE_ROOM: room.id,
            }
          : {}),
        TAB_BROWSER_MONGO: mongo.getUri(),
        TAB_BROWSER_SESSIONS: JSON.stringify(sessions),
      },
    },
  );
  if (live)
    console.log(
      `Live Plans Lab: http://127.0.0.1:${process.env.TAB_BROWSER_PORT ?? "3108"}/app/rooms/${room.id}`,
    );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    child.kill("SIGTERM");
    await mongo.stop();
  }
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
  child.on("exit", (code) => {
    void close().then(() => {
      process.exitCode = code ?? 0;
    });
  });
}
void main();
