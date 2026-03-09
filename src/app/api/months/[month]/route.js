import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse, badRequestResponse } from '@/lib/middleware'

/**
 * GET /api/months/:month
 * Auth: Required
 * Purpose: Get complete data for one month (analytics, banks, cards, checklist)
 */
export async function GET(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        // Handle URL encoded month: "Mar '26" -> "Mar%20'26"
        const { month: rawMonth } = await params
        const month = decodeURIComponent(rawMonth)
        console.log("GET /api/months/:month", { month, userId: user.userId })

        const monthData = await prisma.monthData.findUnique({
            where: { userId_month: { userId: user.userId, month } }
        })

        if (!monthData) return notFoundResponse("No data found for this month")

        // PERFORMANCE: Fetch all related data in PARALLEL using Promise.all
        // This is much faster than waiting for each query one by one.
        const [expenses, banks, cards, settings] = await Promise.all([
            prisma.expense.findMany({ where: { userId: user.userId, month } }),
            prisma.bankAccount.findMany({ where: { userId: user.userId } }),
            prisma.creditCard.findMany({ where: { userId: user.userId } }),
            prisma.userSettings.findUnique({ where: { userId: user.userId } })
        ])

        // 1. Expense Calculations
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
        const ccExpenses = expenses.filter(e => e.paymentMethod === 'creditCard').reduce((sum, e) => sum + e.amount, 0)
        const bankExpenses = totalExpenses - ccExpenses

        // 2. Financial Totals
        const totalBankBalance = banks.reduce((sum, b) => sum + b.balance, 0)
        const totalCCOutstanding = cards.reduce((sum, c) => sum + c.outstandingBill, 0)
        const realAvailable = totalBankBalance - totalCCOutstanding

        // 3. Savings & Budget
        const totalSavings = monthData.rdAmount + monthData.sipAmount + monthData.chitAmount + monthData.efContribution
        const availableToSpend = monthData.openingBalance - totalSavings
        const remaining = availableToSpend - totalExpenses
        const isOverBudget = remaining < 0

        // 4. Rates
        const salary = monthData.salary || settings?.monthlySalary || 0
        const totalIncome = salary + monthData.freelance + monthData.otherIncome
        const actualSavings = totalIncome - totalSavings - totalExpenses
        const savingsRate = totalIncome > 0 ? (actualSavings / totalIncome) * 100 : 0
        const wealthRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0

        // 5. EF Coverage (Capped at 1.0)
        // Assume target is salary * 0.4 (monthly expenses) * 6 months
        const efTarget = salary * 0.4 * 6
        const efCoverage = efTarget > 0 ? Math.min(1.0, monthData.efContribution / efTarget) : 0

        // 6. Category Totals
        const categoryMap = {}
        expenses.forEach(e => {
            categoryMap[e.categoryId] = (categoryMap[e.categoryId] || 0) + e.amount
        })
        const categoryTotals = Object.entries(categoryMap).map(([id, total]) => ({ categoryId: id, total }))

        return Response.json({
            monthData,
            summary: {
                totalIncome,
                totalSavings,
                totalExpenses,
                bankExpenses,
                ccExpenses,
                availableToSpend,
                remaining,
                isOverBudget,
                realAvailable,
                savingsRate: parseFloat(savingsRate.toFixed(1)),
                wealthRate: parseFloat(wealthRate.toFixed(1))
            },
            banks: banks.map(b => ({ id: b.id, nickname: b.nickname, bankName: b.bankName, balance: b.balance })),
            cards: cards.map(c => ({ id: c.id, nickname: c.nickname, outstanding: c.outstandingBill })),
            categoryTotals,
            transferChecklist: [
                { label: "RD / Flat DP", amount: monthData.rdAmount, transferred: monthData.savingsDeducted },
                { label: "SIP / MF", amount: monthData.sipAmount, transferred: monthData.savingsDeducted },
                { label: "Chit Fund", amount: monthData.chitAmount, transferred: monthData.savingsDeducted },
                { label: "Emergency Fund", amount: monthData.efContribution, transferred: monthData.savingsDeducted }
            ],
            efProgress: {
                thisMonth: monthData.efContribution,
                coverage: parseFloat((efCoverage * 100).toFixed(1))
            }
        })
    } catch (error) {
        console.error("GET /api/months/:month Error:", error)
        return serverErrorResponse(error)
    }
}

/**
 * PUT /api/months/:month
 * Auth: Required
 * Purpose: Update month data (e.g. mark transferred, update income)
 */
export async function PUT(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { month: rawMonth } = await params
        const month = decodeURIComponent(rawMonth)
        const body = await request.json()

        const existing = await prisma.monthData.findUnique({
            where: { userId_month: { userId: user.userId, month } }
        })

        if (!existing) return notFoundResponse("No data found for this month")

        // Validate amounts
        const amountFields = ['salary', 'freelance', 'otherIncome', 'rdAmount', 'sipAmount', 'chitAmount', 'efContribution', 'openingBalance']
        for (const field of amountFields) {
            if (body[field] !== undefined && (typeof body[field] !== 'number' || body[field] < 0)) {
                return badRequestResponse(`${field} must be a positive number`)
            }
        }

        // If openingBalance changing, user might want to update bank balance too?
        // For now, simpler to just update MonthData.

        const updated = await prisma.monthData.update({
            where: { userId_month: { userId: user.userId, month } },
            data: body
        })

        // Return updated month data (user can call GET again for full summary or we can re-fetch)
        return Response.json(updated)
    } catch (error) {
        console.error("PUT /api/months/:month Error:", error)
        return serverErrorResponse(error)
    }
}
