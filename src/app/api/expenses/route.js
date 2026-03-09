import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateRequired, validateAmount } from '@/lib/validate'

/**
 * GET /api/expenses
 * Auth: Required
 * Purpose: Get expenses with filters (month, category, payment method)
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { searchParams } = new URL(request.url)
        const month = searchParams.get('month')
        const category = searchParams.get('category')
        const payment = searchParams.get('payment')
        const limit = parseInt(searchParams.get('limit')) || 50
        const offset = parseInt(searchParams.get('offset')) || 0

        if (!month) {
            return badRequestResponse("month query parameter is required (e.g., Mar '26')")
        }

        // Build dynamic where clause
        const where = {
            userId: user.userId,
            month: month
        }

        if (category) where.categoryId = category
        if (payment) where.paymentMethod = payment

        // Run query and count in parallel
        const [expenses, totalCount, aggregate] = await Promise.all([
            prisma.expense.findMany({
                where,
                orderBy: { date: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    bank: {
                        select: { nickname: true, bankName: true }
                    }
                }
            }),
            prisma.expense.count({ where }),
            prisma.expense.aggregate({
                where,
                _sum: { amount: true }
            })
        ])

        return Response.json({
            expenses,
            total: totalCount,
            limit,
            offset,
            month,
            totalAmount: aggregate._sum.amount || 0
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * POST /api/expenses
 * Auth: Required
 * Purpose: Add new expense and update bank/card balances
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['amount', 'categoryId', 'date', 'month', 'paymentMethod']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const {
            amount, categoryId, note,
            date, month, paymentMethod,
            bankId, cardId
        } = body

        // 1. Validations
        if (!validateAmount(amount)) return badRequestResponse("Amount must be greater than 0")

        const validMethods = ['upi', 'debit', 'creditCard', 'cash']
        if (!validMethods.includes(paymentMethod)) {
            return badRequestResponse("paymentMethod must be one of: upi, debit, creditCard, cash")
        }

        // 2. Verify Bank/Card Ownership
        let bank = null
        if (bankId) {
            bank = await prisma.bankAccount.findFirst({
                where: { id: bankId, userId: user.userId }
            })
            if (!bank) return Response.json({ error: "Forbidden", message: "Bank does not belong to you" }, { status: 403 })
        }

        let card = null
        if (cardId) {
            card = await prisma.creditCard.findFirst({
                where: { id: cardId, userId: user.userId }
            })
            if (!card) return Response.json({ error: "Forbidden", message: "Credit card does not belong to you" }, { status: 403 })
        }

        // 3. Prisma Transaction
        const result = await prisma.$transaction(async (tx) => {
            // a. Create expense
            const newExpense = await tx.expense.create({
                data: {
                    userId: user.userId,
                    amount,
                    categoryId,
                    note,
                    date: new Date(date),
                    month,
                    paymentMethod,
                    bankId,
                    // Note: If you want to store cardId in expense table, 
                    // you should have added it to the schema in Step 1.
                    // Checking schema... Step 1 didn't include cardId in Expense model.
                    // I will add it to schema now to avoid data loss.
                }
            })

            let updatedBankBalance = null
            let updatedCardCycleSpend = null

            // b. Handle Bank deduction
            if (['upi', 'debit'].includes(paymentMethod) && bankId) {
                if (bank.balance < amount) {
                    throw new Error("Insufficient bank balance")
                }
                const updatedBank = await tx.bankAccount.update({
                    where: { id: bankId },
                    data: { balance: { decrement: amount } }
                })
                updatedBankBalance = updatedBank.balance
            }

            // c. Handle Credit Card increment
            if (paymentMethod === 'creditCard' && cardId) {
                const updatedCard = await tx.creditCard.update({
                    where: { id: cardId },
                    data: {
                        cycleSpend: { increment: amount },
                        outstandingBill: { increment: amount }
                    }
                })
                updatedCardCycleSpend = updatedCard.cycleSpend
            }

            return { newExpense, updatedBankBalance, updatedCardCycleSpend }
        })

        // 4. Budget Check (Post-transaction)
        try {
            const monthData = await prisma.monthData.findUnique({
                where: { userId_month: { userId: user.userId, month } }
            })

            if (monthData) {
                const totalSpent = await prisma.expense.aggregate({
                    where: { userId: user.userId, month },
                    _sum: { amount: true }
                })
                const totalSavings = monthData.rdAmount + monthData.sipAmount + monthData.chitAmount + monthData.efContribution
                const available = monthData.openingBalance - totalSavings
                const currentSpend = totalSpent._sum.amount || 0

                if (currentSpend > available) {
                    console.log(`[OVER BUDGET ALERT] User: ${user.userId}, Month: ${month}, Spent: ${currentSpend}, Limit: ${available}`)
                }
            }
        } catch (budgetErr) {
            console.error("Budget check failed:", budgetErr)
        }

        return Response.json({
            expense: result.newExpense,
            bankBalance: result.updatedBankBalance,
            cardCycleSpend: result.updatedCardCycleSpend,
            message: "Expense added successfully"
        }, { status: 201 })

    } catch (error) {
        if (error.message === "Insufficient bank balance") {
            return badRequestResponse(error.message)
        }
        return serverErrorResponse(error)
    }
}
