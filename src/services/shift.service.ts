import { PrismaClient, ShiftStatus } from "../generated/prisma/client";

const prisma = new PrismaClient();

export async function startShift(userId: number) {
  const openShift = await prisma.shift.findFirst({
    where: { userId, status: ShiftStatus.ACTIVE } 
  });

  if (openShift) {
    const error: any = new Error("Zaten açık bir vardiyanız var");
    error.statusCode = 409; //
    throw error;
  }

  return prisma.shift.create({
    data: { userId, status: ShiftStatus.ACTIVE } 
  });
}

export async function endShift(userId: number) {
  const activeShift = await prisma.shift.findFirst({
    where: { 
      userId, 
      status: ShiftStatus.ACTIVE 
    }
  });

  if (!activeShift) {
    const error: any = new Error("Sonlandırılacak aktif bir vardiya bulunamadı.");
    error.statusCode = 404; // Bulunamadı
    throw error;
  }

  return prisma.shift.update({
    where: { id: activeShift.id },
    data: { 
      status: ShiftStatus.COMPLETED,
      endTime: new Date()
    }
  });
}

export async function getCurrentShift(userId: number) {
  const currentShift = await prisma.shift.findFirst({
    where: { 
      userId, 
      status: ShiftStatus.ACTIVE 
    }
  });

  return currentShift; // Varsa vardiya objesi, yoksa null döner
}