import { AgentJobs } from "../../../src/lib/dinner/agent/jobs";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { DinnerService } from "../../../src/lib/dinner/service";
import { MongoRoomStore } from "../../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../../src/lib/dinner/agent/service";
import { Attachments } from "../../../src/lib/dinner/attachments";
import { handleDinner } from "../../../src/lib/dinner/http";
import { DinnerError, type Actor } from "../../../src/lib/dinner/model";
import type { AgentRunner } from "../../../src/lib/dinner/agent/capabilities";
import type { AwarenessClassifier } from "../../../src/lib/dinner/agent/awareness";
import type { ReceiptParser } from "../../../src/lib/receipt";

export async function startHarness(
  runner: AgentRunner,
  receiptParser?: ReceiptParser,
  awarenessClassifier?: AwarenessClassifier,
  authenticated = true,
  actionClassifier?: import("../../../src/lib/dinner/agent/action-routing").ActionClassifier,
  burstClassifier?: import("../../../src/lib/dinner/agent/bursts").BurstClassifier,
) {
  const root = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "tab-browser-"));
  const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("browser-conversation");
  const dinner = new DinnerService(new MongoRoomStore(db));
  const alice: Actor = {
    id: randomUUID(),
    name: "Alice",
    twitterSubject: "test-alice",
  };
  const bob: Actor = {
    id: randomUUID(),
    name: "Bob",
    twitterSubject: "test-bob",
  };
  const token = randomUUID();
  const room = await dinner.create(alice, {
    clientId: randomUUID(),
    name: "Browser test dinner",
    purpose: "Isolated conversation test",
  });
  await dinner.setAssistance(room.id, alice, "mentions");
  const invitation = await dinner.invite(room.id, alice, {
    clientId: randomUUID(),
  });
  await dinner.respond(bob, { token: invitation.token }, "accepted");
  const other = await dinner.create(bob, {
    clientId: randomUUID(),
    name: "Private other room",
    purpose: "OTHER_ROOM_SECRET",
  });
  await dinner.send(other.id, bob, {
    clientId: randomUUID(),
    text: "OTHER_ROOM_SECRET",
  });
  const draft = await dinner.draft(room.id, alice, {
    clientId: randomUUID(),
    description: "Existing dinner",
    payerId: alice.id,
    totalCents: 100,
    shares: [
      { userId: alice.id, cents: 50 },
      { userId: bob.id, cents: 50 },
    ],
  });
  await dinner.confirm(room.id, alice, draft.id, randomUUID(), draft.version);
  let agent = new DinnerAgentService(db, dinner, runner, receiptParser, awarenessClassifier, actionClassifier, undefined, burstClassifier);
  const requests: { path: string; method: string; status: number }[] = [];
  const errors: string[] = [];
  const output = path.join(directory, "app.js");
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DinnerShell} from './src/components/dinner/DinnerShell'; import {Room} from './src/components/dinner/Room'; createRoot(document.getElementById('root')).render(<DinnerShell><Room id='${room.id}'/></DinnerShell>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    outfile: output,
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "test-auth-and-router",
        setup(builder) {
          builder.onResolve(
            { filter: /^(next\/(navigation|link)|@privy-io\/react-auth)$/ },
            (args) => ({ path: args.path, namespace: "browser-test" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "browser-test" },
            (args) => ({
              loader: "tsx",
              resolveDir: root,
              contents:
                args.path === "next/link"
                  ? `import React from 'react'; export default function Link(props){return <a {...props}/>}`
                  : args.path === "next/navigation"
                    ? `export const usePathname=()=>location.pathname; export const useRouter=()=>({push:(url)=>location.assign(url)});`
                    : `const getAccessToken=async()=>${JSON.stringify(token)}; export const usePrivy=()=>({ready:true,authenticated:${authenticated},getAccessToken,logout:async()=>{},login:()=>{}}); export const useIdentityToken=()=>({identityToken:${JSON.stringify(token)}});`,
            }),
          );
        },
      },
    ],
  });
  const js = await readFile(output);
  const css = await readFile(path.join(root, "src/app/app/dinner.css"));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/dinner/")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const body = Buffer.concat(chunks);
        const request = new Request(url, {
          method: req.method,
          headers,
          ...(body.length ? { body: new Uint8Array(body) } : {}),
        });
        const response = await handleDinner(
          request,
          url.pathname.slice("/api/dinner/".length).split("/"),
          {
            enabled: true,
            service: dinner,
            agent,
            enqueueAgent: (actor, roomId, message) => new AgentJobs(db, dinner, agent).enqueue(actor, roomId, message, async () => {}),
            attachments: new Attachments(db, dinner),
            actor: async (request) => {
              if (request.headers.get("authorization") !== `Bearer ${token}`)
                throw new DinnerError(401, "Test sign-in required");
              return alice;
            },
          },
        );
        requests.push({
          path: url.pathname,
          method: req.method ?? "GET",
          status: response.status,
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } else if (url.pathname === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(js);
      } else if (url.pathname === "/dinner.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(css);
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          '<!doctype html><html><head><link rel="stylesheet" href="/dinner.css"><style>body{margin:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      res.writeHead(500);
      res.end("Test server failed");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    alice,
    bob,
    room,
    other,
    db,
    dinner,
    requests,
    errors,
    restartAgent() { agent = new DinnerAgentService(db, dinner, runner, receiptParser, awarenessClassifier, actionClassifier, undefined, burstClassifier); },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.close();
      await mongo.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
