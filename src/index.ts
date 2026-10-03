import { authenticateToken } from "./middleware/auth";
import { startShift } from "./services/shift.service";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { PrismaClient } from './generated/prisma/client';
import express from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

app.get("/", (req, res) => { res.send("Vardiya defteri API çalışıyor..."); });

app.get('/users', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

app.post('/register', async (req, res) => {
  const { email, name, password } = req.body;
  const salt = randomBytes(16).toString("hex");
  const hashedPassword = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const user = await prisma.user.create({
    data: { email, name, password: hashedPassword }
  });
  res.json({ id: user.id, email: user.email, name: user.name });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Email veya şifre hatalı" });
  }

  const passwordHash = user.password;
  if (!passwordHash || !passwordHash.includes(":")) {
    return res.status(401).json({ error: "Email veya şifre hatalı" });
  }

  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return res.status(401).json({ error: "Email veya şifre hatalı" });
  }

  const inputHash = scryptSync(password, salt, 64).toString("hex");
  const isMatch = timingSafeEqual(
    Buffer.from(storedHash, "hex"),
    Buffer.from(inputHash, "hex")
  );

  if (!isMatch) {
    return res.status(401).json({ error: "Email veya şifre hatalı" });
  }

  const token = jwt.sign(
  { id: user.id, email: user.email, role: user.role },
  process.env.JWT_SECRET!,
  { expiresIn: "8h" }
);

res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.listen(3000, () => { console.log("Server is running on port 3000"); });


app.post('/shifts/start', authenticateToken, async (req, res) => {
  try {
    const shift = await startShift(req.user!.id);
    res.json(shift);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});