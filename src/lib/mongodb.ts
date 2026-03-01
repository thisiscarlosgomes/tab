import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client;
let clientPromise: Promise<MongoClient> | undefined;

async function ensureIndexes(mongoClient: MongoClient) {
  const db = mongoClient.db();

  await Promise.all([
    db.collection("a-split-game").createIndex(
      { gameId: 1 },
      { unique: true, collation: { locale: "en", strength: 2 } }
    ),
    db
      .collection("a-split-game")
      .createIndex({ "participants.address": 1, createdAt: -1 }),
    db.collection("a-split-game").createIndex({ admin: 1, createdAt: -1 }),

    db
      .collection("a-split-bill")
      .createIndex({ "creator.address": 1, createdAt: -1 }),
    db
      .collection("a-split-bill")
      .createIndex({ "participants.address": 1, createdAt: -1 }),
    db
      .collection("a-split-bill")
      .createIndex({ "invited.address": 1, createdAt: -1 }),

    db.collection("a-activity").createIndex({ address: 1, timestamp: -1 }),

    db
      .collection("a-web-push-subscriptions")
      .createIndex({ enabled: 1, addresses: 1, updatedAt: -1 }),
    db
      .collection("a-web-push-subscriptions")
      .createIndex({ userId: 1, enabled: 1, updatedAt: -1 }),
    db
      .collection("a-web-push-dedupe")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }),

    db.collection("a-agent-access").createIndex({ address: 1 }, { unique: true }),
    db.collection("a-agent-access").createIndex({ userId: 1 }),
    db.collection("a-agent-access").createIndex({ status: 1, updatedAt: -1 }),

    db
      .collection("a-agent-settlement")
      .createIndex({ userId: 1, day: 1, createdAt: -1 }),
    db
      .collection("a-agent-settlement")
      .createIndex({ splitId: 1, payerAddress: 1, createdAt: -1 }),

    db
      .collection("a-agent-transfer")
      .createIndex({ userId: 1, day: 1, createdAt: -1 }),
    db
      .collection("a-agent-transfer")
      .createIndex({ userId: 1, requestId: 1 }, { unique: true }),
    db
      .collection("a-agent-transfer")
      .createIndex({ status: 1, sourceWalletAddress: 1, createdAt: -1 }),
    db
      .collection("a-agent-transfer")
      .createIndex({ status: 1, recipientAddress: 1, createdAt: -1 }),

    db
      .collection("a-agent-links")
      .createIndex({ userId: 1, agentId: 1 }, { unique: true }),
    db
      .collection("a-agent-links")
      .createIndex({ userId: 1, status: 1, updatedAt: -1 }),
    db
      .collection("a-agent-links")
      .createIndex({ agentId: 1, status: 1, updatedAt: -1 }),

    db
      .collection("a-agent-link-claims")
      .createIndex({ tokenHash: 1 }, { unique: true }),
    db
      .collection("a-agent-link-claims")
      .createIndex({ status: 1, expiresAt: 1 }),

    db.collection("a-user-profile").createIndex({ userId: 1 }, { unique: true }),
    db.collection("a-user-profile").createIndex({ fid: 1 }, { unique: true, sparse: true }),
    db.collection("a-user-profile").createIndex(
      { usernameLower: 1 },
      { unique: true, sparse: true }
    ),
    db.collection("a-user-profile").createIndex({ primaryAddress: 1 }, { sparse: true }),
    db
      .collection("a-twitter-oauth")
      .createIndex({ userId: 1 }, { unique: true }),
    db
      .collection("a-twitter-oauth")
      .createIndex({ subject: 1 }, { sparse: true }),
    db
      .collection("a-twitter-identity")
      .createIndex({ subject: 1 }, { unique: true }),
    db
      .collection("a-twitter-identity")
      .createIndex({ usernameLower: 1 }, { sparse: true }),
    db
      .collection("a-twitter-identity")
      .createIndex({ walletAddress: 1 }, { sparse: true }),
    db
      .collection("a-twitter-following-cache")
      .createIndex({ userId: 1, subject: 1, limit: 1 }, { unique: true }),
    db
      .collection("a-twitter-following-cache")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

function getClientPromise(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  if (process.env.NODE_ENV === "development") {
    const globalWithMongo = global as typeof globalThis & {
      _mongoClientPromise?: Promise<MongoClient>;
    };

    if (!globalWithMongo._mongoClientPromise) {
      client = new MongoClient(uri, options);
      globalWithMongo._mongoClientPromise = client
        .connect()
        .then(async (connectedClient) => {
          await ensureIndexes(connectedClient);
          return connectedClient;
        });
    }

    clientPromise = globalWithMongo._mongoClientPromise;
    return clientPromise;
  }

  client = new MongoClient(uri, options);
  clientPromise = client.connect().then(async (connectedClient) => {
    await ensureIndexes(connectedClient);
    return connectedClient;
  });

  return clientPromise;
}

const lazyClientPromise = {
  then<TResult1 = MongoClient, TResult2 = never>(
    onfulfilled?:
      | ((value: MongoClient) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ) {
    return getClientPromise().then(onfulfilled, onrejected);
  },
} as Promise<MongoClient>;

export default lazyClientPromise;
