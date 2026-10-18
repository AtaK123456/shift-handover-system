import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const dummy = `${"0".repeat(32)}:${"0".repeat(128)}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const valid = typeof stored === "string" && /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored);
  const [salt, hash] = (valid ? stored : dummy).split(":") as [string, string];
  const actual = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex")) && valid;
}
