import prisma from '@/lib/prisma'
import crypto from 'crypto'
import { validateEmail } from '@/lib/validate'
import { serverErrorResponse, badRequestResponse } from '@/lib/middleware'

/**
 * POST /api/auth/forgot-password
 * Auth: NOT required
 * Purpose: Send password reset instructions (logs token for now)
 */
export async function POST(request) {
    try {
        const { email } = await request.json()

        if (!email || !validateEmail(email)) {
            return badRequestResponse("Valid email is required")
        }

        // 1. Find user
        const user = await prisma.user.findUnique({
            where: { email }
        })

        // SECURITY: Always return same response to hide if email exists
        const successMessage = { message: "If this email exists we will send reset instructions" }

        if (!user) {
            return Response.json(successMessage)
        }

        // 2. Generate reset token (32 chars hex)
        const resetToken = crypto.randomBytes(32).toString('hex')
        const resetTokenExpiry = new Date(Date.now() + 3600000) // 1 hour from now

        // 3. Save to database
        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken,
                resetTokenExpiry
            }
        })

        // 4. Log token (In M3 this will be a real email)
        console.log("-----------------------------------------")
        console.log(`PASS RESET FOR: ${email}`)
        console.log(`RESET TOKEN: ${resetToken}`)
        console.log(`RESET LINK: http://localhost:3000/reset-password?token=${resetToken}`)
        console.log("-----------------------------------------")

        return Response.json(successMessage)
    } catch (error) {
        return serverErrorResponse(error)
    }
}
