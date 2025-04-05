import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect().then(async (client) => {
      // Create index once on dev server start
      const db = client.db();
      const collection = db.collection("a-split-game");
      await collection.createIndex(
        { gameId: 1 },
        { unique: true, collation: { locale: "en", strength: 2 } } // 👈 makes gameId case-insensitive
      );
      return client;
    });
  }

  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect().then(async (client) => {
    // Create index once on prod cold start
    const db = client.db();
    const collection = db.collection("a-split-game");
    await collection.createIndex(
      { gameId: 1 },
      { unique: true, collation: { locale: "en", strength: 2 } }
    );
    return client;
  });
}

export default clientPromise;