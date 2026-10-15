import { PrismaClient } from '@prisma/client';

// Una sola instancia de Prisma para toda la aplicación.
export const prisma = new PrismaClient();
