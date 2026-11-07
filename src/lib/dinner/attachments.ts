import { Binary, Db, MongoServerError } from "mongodb";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Actor, fail, retryId } from "./model";
import { DinnerService } from "./service";

export class Attachments {
  constructor(
    private db: Db,
    private service: DinnerService,
  ) {}
  private collection() {
    return this.db.collection<{
      id: string;
      roomId: string;
      uploaderId: string;
      clientId: string;
      bytes: Binary;
      createdAt: string;
    }>("dinner-attachments");
  }
  async assertInRoom(roomId: string, actor: Actor, ids: string[]) {
    await this.service.memberRoom(roomId, actor);
    for (const id of ids)
      if (!(await this.collection().findOne({ id, roomId })))
        fail(400, "Attachment does not belong to this room");
  }
  async upload(roomId: string, actor: Actor, request: Request) {
    await this.service.memberRoom(roomId, actor);
    const clientId = retryId.parse(
      new URL(request.url).searchParams.get("clientId"),
    );
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(
        request.headers.get("content-type") ?? "",
      )
    )
      fail(415, "Choose a PNG, JPEG or WebP image");
    const reader = request.body?.getReader() ?? fail(400, "Image is missing");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        fail(413, "Images must be 2 MB or smaller");
      }
      chunks.push(next.value);
    }
    if (!length) fail(400, "Image is empty");
    const input = Buffer.concat(chunks);
    const detected = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : input[0] === 255 && input[1] === 216 && input[2] === 255
        ? "image/jpeg"
        : input.subarray(0, 4).toString() === "RIFF" &&
            input.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null;
    if (!detected || detected !== request.headers.get("content-type"))
      fail(415, "Image type does not match its contents");
    let bytes: Buffer;
    try {
      bytes = await sharp(input, {
        limitInputPixels: 16_000_000,
        animated: false,
      })
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      return fail(415, "This image could not be safely decoded");
    }
    const collection = this.collection();
    await collection.createIndex(
      { roomId: 1, uploaderId: 1, clientId: 1 },
      { unique: true },
    );
    await collection.createIndex({ id: 1 }, { unique: true });
    const previous = await collection.findOne({
      roomId,
      uploaderId: actor.id,
      clientId,
    });
    if (previous) return { id: previous.id };
    if ((await collection.countDocuments({ roomId })) >= 100)
      fail(422, "This beta room has reached its image limit");
    const id = randomUUID();
    try {
      await collection.insertOne({
        id,
        roomId,
        uploaderId: actor.id,
        clientId,
        bytes: new Binary(bytes),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000)
        throw error;
      const existing = await collection.findOne({
        roomId,
        uploaderId: actor.id,
        clientId,
      });
      if (!existing) throw error;
      return { id: existing.id };
    }
    return { id };
  }
  async download(roomId: string, id: string, actor: Actor) {
    await this.service.memberRoom(roomId, actor);
    const file =
      (await this.collection().findOne({ id, roomId })) ??
      fail(404, "Image not found");
    return new Response(new Uint8Array(file.bytes.buffer), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": "inline; filename=receipt.webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }
}
