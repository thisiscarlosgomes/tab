import { MongoClient, type MongoClientOptions } from "mongodb";

export type MongoConnectionCache = { promise?: Promise<MongoClient> };

/** Share an in-flight connection, but never cache a rejected connection forever. */
export function getMongoConnection(
  cache: MongoConnectionCache,
  uri: string,
  initialize: (client: MongoClient) => Promise<void>,
  options: MongoClientOptions = {},
): Promise<MongoClient> {
  if (cache.promise) return cache.promise;
  const client = new MongoClient(uri, options);
  const pending = client
    .connect()
    .then(async () => {
      await initialize(client);
      return client;
    })
    .catch(async (error: unknown) => {
      // Also release connections when index initialization fails after connecting.
      await client.close().catch(() => undefined);
      if (cache.promise === pending) cache.promise = undefined;
      throw error;
    });
  cache.promise = pending;
  return pending;
}
