import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../generated/prisma/client.js";

export function authenticateToken(prisma: PrismaClient, secret: string): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
    if (!match) return res.status(401).json({ error: "Bearer token gerekli" });
    let id: number;
    try {
      const payload = jwt.verify(match[1]!, secret, { algorithms: ["HS256"] });
      if (typeof payload === "string" || !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
          typeof payload.exp !== "number") throw new Error("Invalid claims");
      id = payload.id;
    } catch {
      return res.status(401).json({ error: "Geçersiz veya süresi dolmuş token" });
    }
    try {
      // Güncel rolü veritabanından al: rol değişiklikleri mevcut tokenlara da uygulanır.
      const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (!user) return res.status(401).json({ error: "Geçersiz kullanıcı" });
      req.user = user;
      next();
    } catch (error) { next(error); }
  };
}

export const requireManager: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "MANAGER") return res.status(403).json({ error: "Yönetici yetkisi gerekli" });
  next();
};
