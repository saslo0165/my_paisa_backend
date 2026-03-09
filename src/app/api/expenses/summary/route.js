import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'

/**
 * GET /api/expenses/summary
 * Auth: Required
 * Purpose: Analytics and summary data for a specific month
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { searchParams } = new URL(request.url)
        const month = searchParams.get('month')

        if (!month) {
            return badRequestResponse("month query parameter is required")
        }

        // Fetch all required data in parallel
        const [expenses, monthData, banks, cards, settings] = await Promise.all([
            prisma.expense.findMany({ where: { userId: user.userId, month } }),
            prisma.monthData.findUnique({ where: { userId_month: { userId: user.userId, month } } }),
            prisma.bankAccount.findMany({ where: { userId: user.userId } }),
            prisma.creditCard.findMany({ where: { userId: user.userId } }),
            prisma.userSettings.findUnique({ where: { userId: user.userId } })
        ])

        // 1. Calculate Totals
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
        const bankExpenses = expenses.filter(e => ['upi', 'debit'].includes(e.paymentMethod)).reduce((sum, e) => sum + e.amount, 0)
        const ccExpenses = expenses.filter(e => e.paymentMethod === 'creditCard').reduce((sum, e) => sum + e.amount, 0)
        const cashExpenses = expenses.filter(e => e.paymentMethod === 'cash').reduce((sum, e) => sum + e.amount, 0)

        // 2. Category Breakdown
        const categoryMap = {}
        expenses.forEach(e => {
            if (!categoryMap[e.categoryId]) {
                categoryMap[e.categoryId] = { total: 0, count: 0 }
            }
            categoryMap[e.categoryId].total += e.amount
            categoryMap[e.categoryId].count += 1
        })
        const categoryBreakdown = Object.entries(categoryMap).map(([id, data]) => ({
            categoryId: id,
            total: data.total,
            count: data.count,
            percentage: totalExpenses > 0 ? parseFloat(((data.total / totalExpenses) * 100).toFixed(1)) : 0
        })).sort((a, b) => b.total - a.total)

        // 3. Payment Breakdown
        const paymentMap = {}
        expenses.forEach(e => {
            if (!paymentMap[e.paymentMethod]) {
                paymentMap[e.paymentMethod] = { total: 0, count: 0 }
            }
            paymentMap[e.paymentMethod].total += e.amount
            paymentMap[e.paymentMethod].count += 1
        })
        const paymentBreakdown = Object.entries(paymentMap).map(([method, data]) => ({
            method,
            total: data.total,
            count: data.count,
            percentage: totalExpenses > 0 ? parseFloat(((data.total / totalExpenses) * 100).toFixed(1)) : 0
        }))

        // 4. Daily Spend (Full month array)
        const dailySpendMap = {}
        expenses.forEach(e => {
            const dateStr = e.date.toISOString().split('T')[0]
            dailySpendMap[dateStr] = (dailySpendMap[dateStr] || 0) + e.amount
        })

        // Generate all days for the month (assume month format is "Mar '26")
        // Note: For simplicity, we'll just return days that have expenses or a fixed 31 day range if we can parse it.
        // Let's just return days that exist in the month if we can't easily parse month string here.
        // Actually, let's try a simple parse for the month to get days.
        const monthParts = month.split(" '") // ["Mar", "26"]
        const monthName = monthParts[0]
        const year = 2000 + parseInt(monthParts[1])
        const monthIndex = new Date(`${monthName} 1, 2000`).getMonth()
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

        const dailySpend = []
        for (let i = 1; i <= daysInMonth; i++) {
            const dayStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
            dailySpend.push({
                date: dayStr,
                total: dailySpendMap[dayStr] || 0
            })
        }

        // 5. Budget Status
        const openingBalance = monthData?.openingBalance || 0
        const totalInvested = (monthData?.rdAmount || 0) + (monthData?.sipAmount || 0) + (monthData?.chitAmount || 0) + (monthData?.efContribution || 0)
        const availableToSpend = openingBalance - totalInvested
        const remaining = availableToSpend - totalExpenses

        // 6. Savings Rate
        const salary = monthData?.salary || settings?.monthlySalary || 0
        const actualSavings = salary - totalInvested - totalExpenses
        const targetSavingsPct = settings?.savingsPct || 0.30

        // 7. Bank Summary
        const bankSummary = banks.map(b => {
            const ccOnThisBank = cards.filter(c => c.bankName === b.bankName).reduce((sum, c) => sum + c.outstandingBill, 0)
            return {
                bankId: b.id,
                nickname: b.nickname,
                bankName: b.bankName,
                currentBalance: b.balance,
                ccOutstanding: ccOnThisBank
            }
        })

        const totalBankBalance = banks.reduce((sum, b) => sum + b.balance, 0)
        const totalCCOutstanding = cards.reduce((sum, c) => sum + c.outstandingBill, 0)

        return Response.json({
            month,
            totals: {
                totalExpenses,
                bankExpenses,
                ccExpenses,
                cashExpenses,
                expenseCount: expenses.length
            },
            categoryBreakdown,
            paymentBreakdown,
            dailySpend,
            topCategories: categoryBreakdown.slice(0, 3),
            budgetStatus: {
                openingBalance,
                totalSavings: totalInvested,
                availableToSpend,
                totalSpent: totalExpenses,
                remaining,
                isOverBudget: remaining < 0,
                percentageUsed: availableToSpend > 0 ? parseFloat(((totalExpenses / availableToSpend) * 100).toFixed(1)) : 0
            },
            savingsRate: {
                salary,
                totalInvested,
                totalExpenses,
                actualSavings,
                savingsPercent: salary > 0 ? parseFloat(((actualSavings / salary) * 100).toFixed(1)) : 0,
                wealthBuildPercent: salary > 0 ? parseFloat(((totalInvested / salary) * 100).toFixed(1)) : 0,
                isOnTarget: (salary > 0 && (actualSavings / salary) >= targetSavingsPct)
            },
            bankSummary,
            realAvailable: totalBankBalance - totalCCOutstanding
        })

    } catch (error) {
        return serverErrorResponse(error)
    }
}
