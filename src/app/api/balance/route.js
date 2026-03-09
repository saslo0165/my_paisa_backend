import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateMonth, validateRequired } from '@/lib/validate'
import { toPaise, jsonResponse } from '@/lib/currency'

/**
 * POST /api/balance
 * Auth: Required
 * Purpose: Save opening or closing balance for a specific bank in a month
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['bankId', 'month', 'balanceType', 'amount']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const { bankId, month, balanceType, amount, note } = body

        // 1. Validate balanceType
        if (!['opening', 'closing'].includes(balanceType)) {
            return badRequestResponse("balanceType must be either 'opening' or 'closing'")
        }

        // 2. Validate amount
        if (typeof amount !== 'number' || amount < 0) {
            return badRequestResponse("Amount must be a non-negative number")
        }

        // 3. Validate month format "Mar '26"
        if (!validateMonth(month)) {
            return badRequestResponse("Invalid month format. Expected format: Mar '26")
        }

        // 4. Verify bank ownership
        const bank = await prisma.bank.findFirst({
            where: { id: bankId, userId: user.userId }
        })
        if (!bank) {
            return Response.json(
                { error: "Forbidden", message: "Bank does not belong to you" },
                { status: 403 }
            )
        }

        // 5. Use transaction to Upsert balance and update bank total balance
        const result = await prisma.$transaction(async (tx) => {
            // Upsert MonthlyBalance
            const savedBalance = await tx.monthlyBalance.upsert({
                where: {
                    userId_bankId_month_balanceType: {
                        userId: user.userId,
                        bankId,
                        month,
                        balanceType
                    }
                },
                update: { amount, note },
                create: {
                    userId: user.userId,
                    bankId,
                    month,
                    balanceType,
                    amount,
                    note
                }
            })

            // Update actual bank balance using precision conversion
            await tx.bank.update({
                where: { id: bankId },
                data: { balancePaise: toPaise(amount) }
            })

            return savedBalance
        })

        // Return saved balance with bank details
        const finalBalance = await prisma.monthlyBalance.findUnique({
            where: { id: result.id },
            include: { bank: true }
        })

        return jsonResponse(finalBalance, { status: 201 })
    } catch (error) {
        console.error("POST /api/balance Error:", error)
        return serverErrorResponse(error)
    }
}
