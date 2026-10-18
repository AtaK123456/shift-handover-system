import "dotenv/config";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET en az 32 bayt olmalıdır.");
  }
  return secret;
}
