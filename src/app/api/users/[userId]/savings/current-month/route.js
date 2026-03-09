import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/middleware'
import {
    getCurrentMonthIST,
    formatINR,
    buildSavingResponse
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
                message: "You cannot access another user's savings"
            }, { status: 403 })
        }

        // STEP B — Get current IST month
        const currentMonth = getCurrentMonthIST()

        // STEP C — Fetch all savings for month
        const savings = await prisma.saving.findMany({
            where: {
                userId: pathUserId,
                month: currentMonth
            },
            include: {
                bank: true
            }
        })

        // STEP D — Calculate totals
        const totalPaise = savings.reduce(
            (sum, s) => sum + BigInt(s.amountPaise),
            0n
        )

        // STEP E — Build breakdown by saving type
        const breakdown = {
            rd: { amountPaise: "0", amountFormatted: "₹0.00", isPaid: false },
            sip: { amountPaise: "0", amountFormatted: "₹0.00", isPaid: false },
            chit: { amountPaise: "0", amountFormatted: "₹0.00", isPaid: false },
            ef: { amountPaise: "0", amountFormatted: "₹0.00", isPaid: false },
            custom: { amountPaise: "0", amountFormatted: "₹0.00", isPaid: false }
        }

        savings.forEach(saving => {
            const type = saving.savingType
            if (breakdown[type]) {
                breakdown[type] = {
                    amountPaise: saving.amountPaise.toString(),
                    amountFormatted: formatINR(saving.amountPaise),
                    isPaid: true
                }
            }
        })

        // STEP F — Get current bank balance
        const user = await prisma.user.findUnique({
            where: { id: pathUserId }
        })

        if (!user) {
            return Response.json({ error: "USER_NOT_FOUND", message: "User not found" }, { status: 404 })
        }

        let bankBalanceInfo = {
            balancePaise: "0",
            balanceFormatted: "₹0.00"
        }

        if (user.currentBankId) {
            const bank = await prisma.bank.findFirst({
                where: {
                    id: user.currentBankId,
                    userId: pathUserId,
                    isActive: true
                }
            })

            if (bank) {
                bankBalanceInfo = {
                    balancePaise: bank.balancePaise.toString(),
                    balanceFormatted: formatINR(bank.balancePaise)
                }
            }
        }

        // Add formatted date for UI "March 2026"
        const [yearStr, monthStr] = currentMonth.split('-')
        const monthIndex = parseInt(monthStr, 10) - 1
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
        const monthFormatted = `${monthNames[monthIndex]} ${yearStr}`

        // STEP G — Return response
        return Response.json({
            month: currentMonth,
            monthFormatted,
            totalPaise: totalPaise.toString(),
            totalFormatted: formatINR(totalPaise),
            savingCount: savings.length,
            savings: savings.map(buildSavingResponse),
            breakdown,
            bankBalance: bankBalanceInfo
        }, { status: 200 })

    } catch (error) {
        console.error("GET /api/users/[userId]/savings/current-month Error:", error)
        return Response.json({
            error: "SERVER_ERROR",
            message: "An unexpected error occurred",
            details: process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}
        }, { status: 500 })
    }
}
