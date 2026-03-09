import prisma from '@/lib/prisma'
import { verifyToken, generateAccessToken } from '@/lib/auth'
import { serverErrorResponse, badRequestResponse } from '@/lib/middleware'

/**
 * POST /api/auth/refresh
 * Auth: NOT required
 * Purpose: Get new access token using refresh token
 */
export async function POST(request) {
    try {
        const body = await request.json()
        const { refreshToken } = body

        if (!refreshToken) {
            return badRequestResponse("refreshToken is required")
        }

        // 1. Verify token
        const decoded = verifyToken(refreshToken)
        if (!decoded) {
            return Response.json(
                { error: "Invalid refresh token", message: "Please login again" },
                { status: 401 }
            )
        }

        // 2. Verify user still exists
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        })
        if (!user) {
            return Response.json(
                { error: "User not found", message: "Account no longer exists" },
                { status: 401 }
            )
        }

        // 3. Generate new access token ONLY
        const accessToken = generateAccessToken(user.id)

        return Response.json({
            accessToken,
            expiresIn: "15m",
            message: "Token refreshed successfully"
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
