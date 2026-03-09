import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { serverErrorResponse, badRequestResponse } from '@/lib/middleware'

/**
 * POST /api/auth/reset-password
 * Auth: NOT required
 * Purpose: Reset password using token
 */
export async function POST(request) {
    try {
        const { token, newPassword } = await request.json()

        if (!token || !newPassword) {
            return badRequestResponse("token and newPassword are required")
        }

        if (newPassword.length < 8) {
            return badRequestResponse("newPassword must be at least 8 characters long")
        }

        // 1. Find user with valid and non-expired token
        const user = await prisma.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: {
                    gt: new Date() // Must be in the future
                }
            }
        })

        if (!user) {
            return badRequestResponse("Reset token is invalid or expired")
        }

        // 2. Hash new password (bcrypt rounds 12)
        const salt = await bcrypt.genSalt(12)
        const hashedPassword = await bcrypt.hash(newPassword, salt)

        // 3. Update user and clear token
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetTokenExpiry: null
            }
        })

        return Response.json({
            message: "Password reset successful. Please login with your new password."
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
