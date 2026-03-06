import prisma from '@/lib/prisma'

export async function GET() {
    try {
        // 1. Run a simple query to test DB connection
        // This is like checking if the engine starts
        await prisma.$queryRaw`SELECT 1`

        return Response.json({
            status: "ok",
            database: "connected",
            timestamp: new Date().toISOString()
        }, { status: 200 })

    } catch (error) {
        console.error('Health Check Error:', error)
        return Response.json({
            status: "error",
            message: "Database connection failed"
        }, { status: 500 })
    }
}
