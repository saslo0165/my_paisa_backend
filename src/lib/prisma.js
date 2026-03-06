import { PrismaClient } from '@prisma/client'

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
//
// Learn more:
// https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-with-database-connections

const prismaClientSingleton = () => {
    return new PrismaClient()
}

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = prismaClientSingleton()
}

const prisma = globalForPrisma.prisma

if (process.env.NODE_ENV !== 'production') {
    // In development, we can log queries to see what's happening
    // console.log('Prisma Client Initialized')
}

export default prisma
