import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse, badRequestResponse } from '@/lib/middleware'

/**
 * GET /api/expenses/:id
 * Auth: Required
 * Purpose: Get single expense details
 */
export async function GET(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params
        const expense = await prisma.expense.findFirst({
            where: { id, userId: user.userId },
            include: {
                bank: true,
                card: true
            }
        })

        if (!expense) return notFoundResponse("Expense")

        return Response.json(expense)
    } catch (error) {
        console.error("GET /api/expenses/:id Error:", error)
        return serverErrorResponse(error)
    }
}

/**
 * PUT /api/expenses/:id
 * Auth: Required
 * Purpose: Edit an existing expense and adjust balances accordingly
 */
export async function PUT(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params
        const body = await request.json()

        // 1. Find existing expense
        const oldExpense = await prisma.expense.findFirst({
            where: { id, userId: user.userId }
        })
        if (!oldExpense) return notFoundResponse("Expense")

        // 2. Transaction to reverse old effects and apply new ones
        const updatedExpense = await prisma.$transaction(async (tx) => {

            // a. Reverse Old Effects
            if (['upi', 'debit'].includes(oldExpense.paymentMethod) && oldExpense.bankId) {
                await tx.bankAccount.update({
                    where: { id: oldExpense.bankId },
                    data: { balance: { increment: oldExpense.amount } }
                })
            } else if (oldExpense.paymentMethod === 'creditCard' && oldExpense.cardId) {
                await tx.creditCard.update({
                    where: { id: oldExpense.cardId },
                    data: {
                        cycleSpend: { decrement: oldExpense.amount },
                        outstandingBill: { decrement: oldExpense.amount }
                    }
                })
            }

            // b. Apply New Effects
            // Merge old and new values for deduction logic
            const newAmount = body.amount !== undefined ? body.amount : oldExpense.amount
            const newMethod = body.paymentMethod || oldExpense.paymentMethod
            const newBankId = body.bankId !== undefined ? body.bankId : oldExpense.bankId
            const newCardId = body.cardId !== undefined ? body.cardId : oldExpense.cardId

            if (['upi', 'debit'].includes(newMethod) && newBankId) {
                // Fetch fresh bank balance to check
                const targetBank = await tx.bankAccount.findUnique({ where: { id: newBankId } })
                if (!targetBank || targetBank.balance < newAmount) {
                    throw new Error("Insufficient bank balance")
                }
                await tx.bankAccount.update({
                    where: { id: newBankId },
                    data: { balance: { decrement: newAmount } }
                })
            } else if (newMethod === 'creditCard' && newCardId) {
                await tx.creditCard.update({
                    where: { id: newCardId },
                    data: {
                        cycleSpend: { increment: newAmount },
                        outstandingBill: { increment: newAmount }
                    }
                })
            }

            // c. Update the expense record
            return tx.expense.update({
                where: { id },
                data: {
                    ...body,
                    date: body.date ? new Date(body.date) : undefined
                },
                include: { bank: true, card: true }
            })
        })

        return Response.json(updatedExpense)
    } catch (error) {
        console.error("PUT /api/expenses/:id Error:", error)
        if (error.message === "Insufficient bank balance") {
            return badRequestResponse(error.message)
        }
        return serverErrorResponse(error)
    }
}

/**
 * DELETE /api/expenses/:id
 * Auth: Required
 * Purpose: Delete expense and restore bank/card balances
 */
export async function DELETE(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params
        const expense = await prisma.expense.findFirst({
            where: { id, userId: user.userId }
        })

        if (!expense) return notFoundResponse("Expense")

        const result = await prisma.$transaction(async (tx) => {
            let updatedBankBalance = null
            let updatedCardCycleSpend = null

            // Reverse effects
            if (['upi', 'debit'].includes(expense.paymentMethod) && expense.bankId) {
                const bank = await tx.bankAccount.update({
                    where: { id: expense.bankId },
                    data: { balance: { increment: expense.amount } }
                })
                updatedBankBalance = bank.balance
            } else if (expense.paymentMethod === 'creditCard' && expense.cardId) {
                const card = await tx.creditCard.update({
                    where: { id: expense.cardId },
                    data: {
                        cycleSpend: { decrement: expense.amount },
                        outstandingBill: { decrement: expense.amount }
                    }
                })
                // Ensure they don't go below 0 (though logically shouldn't)
                if (card.cycleSpend < 0 || card.outstandingBill < 0) {
                    await tx.creditCard.update({
                        where: { id: expense.cardId },
                        data: {
                            cycleSpend: Math.max(0, card.cycleSpend),
                            outstandingBill: Math.max(0, card.outstandingBill)
                        }
                    })
                }
                updatedCardCycleSpend = Math.max(0, card.cycleSpend)
            }

            // Delete record
            await tx.expense.delete({ where: { id } })

            return { updatedBankBalance, updatedCardCycleSpend }
        })

        return Response.json({
            message: "Expense deleted successfully",
            bankBalance: result.updatedBankBalance,
            cardCycleSpend: result.updatedCardCycleSpend
        })
    } catch (error) {
        console.error("DELETE /api/expenses/:id Error:", error)
        return serverErrorResponse(error)
    }
}
