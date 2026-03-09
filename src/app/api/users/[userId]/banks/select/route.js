import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/middleware'
import { buildBankResponse } from '@/lib/savings-helpers'

export async function POST(request, { params }) {
    try {
        // STEP A — Auth + userId match check
        const decoded = requireAuth(request)
        if (!decoded) {
            return Response.json({
                error: "UNAUTHORIZED", message: "Missing or invalid token"
            }, { status: 401 })
        }

        const tokenUserId = decoded.userId
        const { userId: rawPathUserId } = await params
        const pathUserId = decodeURIComponent(rawPathUserId)

        if (tokenUserId !== pathUserId) {
            return Response.json({
                error: "FORBIDDEN",
                message: "You cannot access another user's profile"
            }, { status: 403 })
        }

        // STEP B — Parse body
        const body = await request.json()
        const { bankId } = body

        if (!bankId) {
            return Response.json({
                error: "BANK_ID_REQUIRED",
                message: "bankId is required"
            }, { status: 400 })
        }

        // STEP C — Verify bank belongs to user
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(bankId) || !uuidRegex.test(pathUserId)) {
            return Response.json({
                error: "BANK_NOT_FOUND",
                message: "Bank not found or does not belong to you"
            }, { status: 404 })
        }

        const bank = await prisma.bank.findFirst({
            where: {
                id: bankId,
                userId: pathUserId,
                isActive: true
            }
        })

        if (!bank) {
            return Response.json({
                error: "BANK_NOT_FOUND",
                message: "Bank not found or does not belong to you"
            }, { status: 404 })
        }

        // STEP D — Update user's currentBankId
        await prisma.user.update({
            where: { id: pathUserId },
            data: { currentBankId: bankId }
        })

        // STEP E — Return
        return Response.json({
            message: "Current bank updated successfully",
            currentBank: buildBankResponse(bank)
        }, { status: 200 })

    } catch (error) {
        console.error("POST /api/users/[userId]/banks/select Error:", error)
        return Response.json({
            error: "SERVER_ERROR",
            message: "An unexpected error occurred",
            details: process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}
        }, { status: 500 })
    }
}
