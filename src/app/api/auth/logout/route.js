import { requireAuth, unauthorizedResponse, serverErrorResponse } from '@/lib/middleware'

/**
 * POST /api/auth/logout
 * Auth: Required
 * Purpose: Logout current user session
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        // In Milestone 3, we will add token blacklisting with Redis here.
        // For now, we just return success and the client will clear local storage.

        return Response.json({
            message: "Logged out successfully",
            userId: user.userId
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
