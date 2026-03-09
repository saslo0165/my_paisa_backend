import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/middleware'
import {
    getCurrentMonthIST,
    formatINR,
    buildBankResponse
} from '@/lib/savings-helpers'

export async function GET(request, { params }) {
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
                message: "You cannot access another user's bank"
            }, { status: 403 })
        }

        // STEP B — Fetch user
        const user = await prisma.user.findUnique({
            where: { id: pathUserId }
        })

        if (!user) {
            return Response.json({ error: "USER_NOT_FOUND", message: "User not found" }, { status: 404 })
        }

        const currentBankId = user.currentBankId

        // STEP C — If no currentBankId
        if (!currentBankId) {
            return Response.json({
                error: "NO_CURRENT_BANK",
                message: "No bank selected. Use POST /users/{userId}/banks/select to choose a bank first."
            }, { status: 404 })
        }

        // STEP D — Fetch bank
        const bank = await prisma.bank.findFirst({
            where: {
                id: currentBankId,
                userId: pathUserId,
                isActive: true
            }
        })

        if (!bank) {
            return Response.json({
                error: "BANK_NOT_FOUND",
                message: "Selected bank not found or has been deactivated."
            }, { status: 404 })
        }

        // STEP E — Get this month's savings total
        const savingsAgg = await prisma.saving.aggregate({
            where: {
                userId: pathUserId,
                month: getCurrentMonthIST()
            },
            _sum: {
                amountPaise: true
            },
            _count: true
        })

        const monthTotal = savingsAgg._sum.amountPaise || 0n
        const count = savingsAgg._count || 0

        // STEP F — Return response
        return Response.json({
            bank: buildBankResponse(bank),
            thisMonthDeducted: {
                totalPaise: monthTotal.toString(),
                totalFormatted: formatINR(monthTotal),
                savingCount: count
            },
            realAvailablePaise: bank.balancePaise.toString(),
            realAvailableFormatted: formatINR(bank.balancePaise)
        }, { status: 200 })

    } catch (error) {
        console.error("GET /api/users/[userId]/banks/current Error:", error)
        return Response.json({
            error: "SERVER_ERROR",
            message: "An unexpected error occurred",
            details: process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}
        }, { status: 500 })
    }
}
