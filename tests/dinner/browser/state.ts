// Test-only server composition. This directory is not part of src/app and cannot
// add a test login or auth bypass to the deployed application.
import * as nodeHttp from "node:http";
import { MongoClient } from "mongodb";
// Opt-in local transport only. Keep fixture traffic off the external proxy.
const proxyGlobal = globalThis as typeof globalThis & { tabFixtureProxy?: string };
const fixtureProxy = process.env.TAB_TEST_HTTPS_PROXY;
if (fixtureProxy && proxyGlobal.tabFixtureProxy !== fixtureProxy) {
  const configure = (nodeHttp as unknown as {
    setGlobalProxyFromEnv?: (env: Record<string, string>) => unknown;
  }).setGlobalProxyFromEnv;
  if (!configure) throw new Error("Fixture proxy requires Node with setGlobalProxyFromEnv support");
  configure({ HTTPS_PROXY: fixtureProxy, HTTP_PROXY: fixtureProxy, NO_PROXY: "localhost,127.0.0.1,::1" });
  proxyGlobal.tabFixtureProxy = fixtureProxy;
}
import { z } from "zod";
import { DinnerService } from "@/lib/dinner/service";
import { MongoRoomStore } from "@/lib/dinner/mongo-store";
import { PlanService } from "@/lib/dinner/plans/service";
import { Attachments } from "@/lib/dinner/attachments";
import { DinnerAgentService } from "@/lib/dinner/agent/service";
import { DinnerError } from "@/lib/dinner/model";
const uri = process.env.TAB_BROWSER_MONGO ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri))
  throw new Error("Browser fixture requires disposable loopback Mongo");
export const sessions = z
  .array(
    z.object({
      token: z.string(),
      actor: z.object({
        id: z.string(),
        name: z.string(),
        twitterSubject: z.null(),
      }),
    }),
  )
  .parse(JSON.parse(process.env.TAB_BROWSER_SESSIONS ?? "[]"));
// Next dev reloads this module across routes. Keep one bounded pool per URI.
const fixtureGlobal = globalThis as typeof globalThis & {
  tabFixtureMongo?: { uri: string; client: MongoClient };
};
if (!fixtureGlobal.tabFixtureMongo || fixtureGlobal.tabFixtureMongo.uri !== uri)
  fixtureGlobal.tabFixtureMongo = {
    uri,
    client: new MongoClient(uri, { maxPoolSize: 10 }),
  };
const db = fixtureGlobal.tabFixtureMongo.client.db("tab_browser_fixture");
const service = new DinnerService(new MongoRoomStore(db));
export function actor(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("tab-test-session="))
    ?.slice("tab-test-session=".length);
  const session = sessions.find((s) => s.token === token);
  if (!session) throw new DinnerError(401, "Test session required");
  return Promise.resolve(session.actor);
}
const testClock = globalThis as typeof globalThis & {
  tabPlanTestTime?: string;
};
export function setTestTime(value: string | null) {
  testClock.tabPlanTestTime = value ?? undefined;
}
export const dependencies = {
  enabled: true,
  actor,
  service,
  plans: new PlanService(
    db,
    service,
    () => testClock.tabPlanTestTime ?? new Date().toISOString(),
  ),
  attachments: new Attachments(db, service),
  agent: new DinnerAgentService(db, service),
};
