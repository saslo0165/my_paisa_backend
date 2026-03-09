import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse, badRequestResponse } from '@/lib/middleware'
import { toPaise, jsonResponse } from '@/lib/currency'

/**
 * POST /api/cards/:id/pay
 * Auth: Required
 * Purpose: Pay credit card bill from bank account
 */
export async function POST(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params
        const { amount, bankId } = await request.json()

        if (!amount || amount <= 0) return badRequestResponse("Invalid amount")
        if (!bankId) return badRequestResponse("Bank ID is required")

        // 1 & 2. Verify card and bank ownership
        const card = await prisma.creditCard.findFirst({
            where: { id, userId: user.userId }
        })
        const bank = await prisma.bank.findFirst({
            where: { id: bankId, userId: user.userId }
        })

        if (!card) return notFoundResponse("Credit card")
        if (!bank) return notFoundResponse("Bank account")

        // 3. Convert payment amount to paise
        const amountPaise = toPaise(amount)

        // 4. Validate bank balance
        if (bank.balancePaise < amountPaise) {
            return badRequestResponse("Insufficient balance in bank account")
        }

        // 5. Prisma Transaction: Either both succeed or both fail
        const [updatedCard, updatedBank] = await prisma.$transaction([
            // Deduct from outstanding / reset cycle spend
            prisma.creditCard.update({
                where: { id },
                data: {
                    outstandingBill: { decrement: amount },
                    cycleSpend: 0 // Assumes bill payment covers current cycle or resets it
                }
            }),
            // Deduct from bank
            prisma.bank.update({
                where: { id: bankId },
                data: {
                    balancePaise: { decrement: amountPaise }
                }
            })
        ])

        console.log(`[NOTIFICATION] CC bill of ${amount} paid from bank ${bank.bankName}`)

        return jsonResponse({
            message: "Bill paid successfully",
            card: updatedCard,
            bank: updatedBank
        })
    } catch (error) {
        console.error("POST /api/cards/:id/pay Error:", error)
        return serverErrorResponse(error)
    }
}
