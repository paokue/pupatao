import { PrismaClient } from '@prisma/client'

// Single Prisma instance per process. Prevents "too many connections" during
// dev HMR (Vite re-evaluates modules on change, which would re-instantiate).
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

export const prisma = globalForPrisma.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma
}
