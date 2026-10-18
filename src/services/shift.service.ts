import { Prisma, type PrismaClient, ShiftStatus } from "../generated/prisma/client.js";

class ShiftError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export function createShiftService(prisma: PrismaClient) {
  async function startShift(userId: number, schedule?: { shiftDate: string; scheduledStart: string; scheduledEnd: string }) {
    // The database index arbitrates concurrent requests, including across servers.
    try {
      return await prisma.shift.create({ data: { userId, status: ShiftStatus.ACTIVE, ...schedule } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const adapterError = error.meta?.driverAdapterError as {
          cause?: { constraint?: { index?: string } }
        } | undefined;
        const target = error.meta?.target;
        if ((Array.isArray(target) && target.includes("userId")) ||
            adapterError?.cause?.constraint?.index === "Shift_one_active_per_user") {
          throw new ShiftError("Zaten açık bir vardiyanız var", 409);
        }
      }
      throw error;
    }
  }

  async function endShift(userId: number) {
    const activeShift = await prisma.shift.findFirst({ where: { userId, status: ShiftStatus.ACTIVE } });
    if (!activeShift) throw new ShiftError("Sonlandırılacak aktif bir vardiya bulunamadı.", 404);

    // Only the first caller may close this shift; later callers cannot overwrite endTime.
    const result = await prisma.shift.updateMany({
      where: { id: activeShift.id, userId, status: ShiftStatus.ACTIVE },
      data: { status: ShiftStatus.COMPLETED, endTime: new Date() }
    });
    if (result.count === 0) throw new ShiftError("Sonlandırılacak aktif bir vardiya bulunamadı.", 404);
    return prisma.shift.findUniqueOrThrow({ where: { id: activeShift.id } });
  }

  async function getCurrentShift(userId: number) {
    return prisma.shift.findFirst({ where: { userId, status: ShiftStatus.ACTIVE } });
  }

  return { startShift, endShift, getCurrentShift };
}
