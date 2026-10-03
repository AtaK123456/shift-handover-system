import { authenticateToken } from "./middleware/auth";
import { startShift, endShift, getCurrentShift } from "./services/shift.service";
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
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true
    }
  });
  res.json(users);
});

app.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    
    // Gelen verilerin boş olup olmadığını kontrol et (Validation)
    if (!email || !name || !password) {
      return res.status(400).json({ error: "E-posta, isim ve şifre zorunludur." });
    }

    const salt = randomBytes(16).toString("hex");
    const hashedPassword = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    
    const user = await prisma.user.create({
      data: { email, name, password: hashedPassword }
    });
    
    res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    // Prisma benzersiz (unique) kısıtlama hatası: Email zaten var
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "Bu email adresi zaten kullanımda." });
    }
    // Diğer beklenmedik sunucu hataları
    res.status(500).json({ error: "Kayıt işlemi sırasında bir hata oluştu." });
  }
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


app.post('/shifts/start', authenticateToken, async (req, res) => {
  try {
    const shift = await startShift(req.user!.id);
    res.status(201).json(shift);
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

app.post('/shifts/end', authenticateToken, async (req, res) => {
  try {
    const shift = await endShift(req.user!.id);
    res.json({
      message: "Vardiya başarıyla sonlandırıldı.",
      shift
    });
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

app.get('/shifts/current', authenticateToken, async (req, res) => {
  try {
    const shift = await getCurrentShift(req.user!.id);
    
    // Eğer açık vardiya varsa gönder, yoksa null gönder (Frontend bunu bekler)
    res.json({ currentShift: shift || null }); 
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

app.listen(3000, () => { console.log("Server is running on port 3000"); });