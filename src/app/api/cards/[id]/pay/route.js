import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse, badRequestResponse } from '@/lib/middleware'

/**
 * POST /api/cards/:id/pay
 * Auth: Required
 * Purpose: Pay credit card bill from bank account
 * Flutter comparison: This is like a Batch DB operation in sqflite
 */
export async function POST(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = params
        const { amount, bankId } = await request.json()

        if (!amount || amount <= 0) return badRequestResponse("Invalid amount")
        if (!bankId) return badRequestResponse("Bank ID is required")

        // 1 & 2. Verify card and bank ownership
        const card = await prisma.creditCard.findFirst({
            where: { id, userId: user.userId }
        })
        const bank = await prisma.bankAccount.findFirst({
            where: { id: bankId, userId: user.userId }
        })

        if (!card) return notFoundResponse("Credit card")
        if (!bank) return notFoundResponse("Bank account")

        // 3. Validate bank balance
        if (bank.balance < amount) {
            return badRequestResponse("Insufficient balance in bank account")
        }

        // 4. Prisma Transaction: Either both succeed or both fail
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
            prisma.bankAccount.update({
                where: { id: bankId },
                data: {
                    balance: { decrement: amount }
                }
            })
        ])

        // Trigger notification (log for now)
        console.log(`[NOTIFICATION] CC bill of ${amount} paid from bank ${bank.bankName}`)

        return Response.json({
            message: "Bill paid successfully",
            card: updatedCard,
            bank: updatedBank
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
