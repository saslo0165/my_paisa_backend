import prisma from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export async function GET(request) {
    try {
        // 1. Authenticate user from JWT in Request Header
        const decoded = getUserFromRequest(request)

        if (!decoded) {
            // Like being denied entry to a VIP lounge without a pass
            return Response.json({
                error: "Unauthorized. Please provide a valid token."
            }, { status: 401 })
        }

        // 2. Fetch user profile from DB using decoded userId
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                settings: true // Include their settings automatically
            }
        })

        if (!user) {
            return Response.json({
                error: "User not found"
            }, { status: 404 })
        }

        // 3. Return user object (safely remove password)
        const { password: _, ...userWithoutPassword } = user

        return Response.json({
            user: userWithoutPassword
        }, { status: 200 })

    } catch (error) {
        console.error('Profile Fetch Error:', error)
        return Response.json({
            error: "Something went wrong on the server"
        }, { status: 500 })
    }
}
