import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = new PrismaClient({
  adapter,
} as any);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
