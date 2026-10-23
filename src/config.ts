import "dotenv/config";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET en az 32 bayt olmalıdır.");
  }
  return secret;
}

export function getRegistrationCode(): string | null {
  const code = process.env.REGISTRATION_CODE;
  if (!code || code.trim().length === 0) return null;
  if (code.length < 12 || code.length > 128) {
    throw new Error("REGISTRATION_CODE 12–128 karakter olmalıdır; kaydı kapatmak için boş bırakın.");
  }
  return code;
}
