import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  getMongoConnection,
  type MongoConnectionCache,
} from "../../src/lib/mongo-connection";

test("Mongo reconnects after initial network failure instead of poisoning every later request", async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  const cache: MongoConnectionCache = {};
  try {
    await mongo.stop({ doCleanup: false });
    const options = { serverSelectionTimeoutMS: 300, connectTimeoutMS: 200 };
    const initialize = async () => {};
    const failed = getMongoConnection(cache, uri, initialize, options);
    assert.equal(getMongoConnection(cache, uri, initialize, options), failed);
    await assert.rejects(failed);
    await mongo.start(true);
    const recovered = getMongoConnection(cache, uri, initialize, options);
    assert.notEqual(recovered, failed);
    assert.equal(
      getMongoConnection(cache, uri, initialize, options),
      recovered,
    );
    const client = await recovered;
    assert.equal((await client.db().command({ ping: 1 })).ok, 1);
    assert.equal(
      await getMongoConnection(cache, uri, initialize, options),
      client,
    );
  } finally {
    await cache.promise?.then(
      (c) => c.close(),
      () => undefined,
    );
    await mongo.stop();
  }
});

test("failed index initialization is retryable and the next request initializes successfully", async () => {
  const mongo = await MongoMemoryServer.create();
  const cache: MongoConnectionCache = {};
  let attempts = 0;
  const initialize = async (client: import("mongodb").MongoClient) => {
    if (++attempts === 1) throw new Error("Temporary initialization failure");
    await client
      .db()
      .collection("retry-fixture")
      .createIndex({ id: 1 }, { unique: true });
  };
  try {
    await assert.rejects(
      getMongoConnection(cache, mongo.getUri(), initialize),
      /Temporary initialization failure/,
    );
    const client = await getMongoConnection(cache, mongo.getUri(), initialize);
    assert.equal(attempts, 2);
    assert.ok(
      (await client.db().collection("retry-fixture").indexes()).some(
        (i) => i.name === "id_1",
      ),
    );
  } finally {
    await cache.promise?.then(
      (c) => c.close(),
      () => undefined,
    );
    await mongo.stop();
  }
});
