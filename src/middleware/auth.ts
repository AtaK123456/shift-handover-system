import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token gerekli" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: number; email: string; role: string };
    req.user = payload;
    next();
  } catch {
    return res.status(403).json({ error: "Geçersiz veya süresi dolmuş token" });
  }
}