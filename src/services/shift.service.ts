import { PrismaClient } from "../generated/prisma/client";

const prisma = new PrismaClient();

export async function startShift(userId: number) {
  const openShift = await prisma.shift.findFirst({
    where: { userId, status: "ACTIVE" }
  });

  if (openShift) {
    throw new Error("Zaten açık bir vardiyanız var");
  }

  return prisma.shift.create({
    data: { userId, status: "ACTIVE" }
  });
}