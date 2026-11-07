import { Collection, Db, MongoServerError } from "mongodb";
import { Actor, DinnerError, Room } from "./model";
import { RoomStore } from "./service";
import { randomUUID } from "node:crypto";

export class MongoRoomStore implements RoomStore {
  private rooms: Collection<Room>;
  private ready: Promise<unknown>;
  constructor(db: Db) {
    this.rooms = db.collection<Room>("dinner-rooms");
    this.ready = this.rooms.createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { ownerId: 1, creationId: 1 }, unique: true },
      { key: { "members.userId": 1 } },
      { key: { "invitations.tokenHash": 1 } },
      { key: { "invitations.targetSubject": 1 } },
    ]);
  }
  async insert(room: Room): Promise<Room> {
    await this.ready;
    try {
      await this.rooms.insertOne({ ...room });
      return room;
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000)
        throw error;
      const existing = await this.rooms.findOne({
        ownerId: room.ownerId,
        creationId: room.creationId,
      });
      if (
        !existing ||
        existing.name !== room.name ||
        existing.purpose !== room.purpose
      )
        throw new DinnerError(
          409,
          "Retry ID already used for a different room",
        );
      return existing;
    }
  }
  async get(id: string) {
    await this.ready;
    return this.rooms.findOne({ id }, { projection: { _id: 0 } });
  }
  async byToken(hash: string) {
    await this.ready;
    return this.rooms.findOne(
      { "invitations.tokenHash": hash },
      { projection: { _id: 0 } },
    );
  }
  async list(userId: string, subject: string | null) {
    await this.ready;
    return this.rooms
      .find(
        subject
          ? {
              $or: [
                { "members.userId": userId },
                { "invitations.targetSubject": subject },
              ],
            }
          : { "members.userId": userId },
        { projection: { _id: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
  }
  async compareAndSwap(room: Room, revision: number) {
    await this.ready;
    return (
      (await this.rooms.replaceOne({ id: room.id, revision }, room))
        .matchedCount === 1
    );
  }
}
export type VerifiedProfile = {
  privyId: string;
  name: string;
  twitterSubject: string | null;
};
export async function actorForProfile(
  db: Db,
  profile: VerifiedProfile,
): Promise<Actor> {
  const users = db.collection<{
    id: string;
    privyId: string;
    name: string;
    twitterSubject: string | null;
  }>("dinner-users");
  await users.createIndex({ privyId: 1 }, { unique: true });
  try {
    await users.updateOne(
      { privyId: profile.privyId },
      {
        $setOnInsert: { id: randomUUID(), privyId: profile.privyId },
        $set: { name: profile.name, twitterSubject: profile.twitterSubject },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000)
      throw error;
  }
  const user = await users.findOne({ privyId: profile.privyId });
  if (!user) throw new DinnerError(503, "Could not load your room identity");
  return {
    id: user.id,
    name: profile.name,
    twitterSubject: profile.twitterSubject,
  };
}
