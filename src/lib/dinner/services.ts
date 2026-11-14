import { DinnerAgentService } from "./agent/service";
import { MongoRoomStore } from "./mongo-store";
import { DinnerService } from "./service";
import { Attachments } from "./attachments";
// Services hold database handles and index readiness, never request identity.
let services:
  | Promise<{
      db: import("mongodb").Db;
      service: DinnerService;
      agent: DinnerAgentService;
      attachments: Attachments;
    }>
  | undefined;
export function getDinnerServices() {
  return (services ??= (async () => {
    const { default: clientPromise } = await import("@/lib/mongodb");
    const db = (await clientPromise).db();
    const service = new DinnerService(new MongoRoomStore(db));
    return {
      db,
      service,
      agent: new DinnerAgentService(db, service),
      attachments: new Attachments(db, service),
    };
  })().catch((error) => {
    services = undefined;
    throw error;
  }));
}
