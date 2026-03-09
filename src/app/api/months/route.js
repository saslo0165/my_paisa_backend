import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateMonth, validateRequired } from '@/lib/validate'

/**
 * GET /api/months
 * Auth: Required
 * Purpose: Get list of all months user has set up data for, enriched with totals
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const monthDataList = await prisma.monthData.findMany({
            where: { userId: user.userId },
            orderBy: { createdAt: 'desc' }
        })

        // Current month logic for status
        const now = new Date()
        const currentMonthName = now.toLocaleString('default', { month: 'short' })
        const currentYearShort = now.getFullYear().toString().slice(-2)
        const currentMonthStr = `${currentMonthName} '${currentYearShort}`

        // Enrich months with calculated data
        const enrichedMonths = await Promise.all(monthDataList.map(async (m) => {
            const expenses = await prisma.expense.aggregate({
                where: { userId: user.userId, month: m.month },
                _sum: { amount: true }
            })

            const totalExpenses = expenses._sum.amount || 0
            const totalSavings = m.rdAmount + m.sipAmount + m.chitAmount + m.efContribution
            const totalIncome = m.salary + m.freelance + m.otherIncome
            const actualSavings = totalIncome - totalSavings - totalExpenses

            // Status logic
            let status = "completed"
            if (m.month === currentMonthStr) {
                status = "active"
            } else {
                // Determine if future or past
                const [mName, mYear] = m.month.split(" '")
                const mDate = new Date(`${mName} 1, 20${mYear}`)
                if (mDate > now) status = "upcoming"
            }

            return {
                ...m,
                totalExpenses,
                totalSavings,
                availableToSpend: m.openingBalance - totalSavings,
                totalIncome,
                actualSavings,
                savingsRate: totalIncome > 0 ? parseFloat(((actualSavings / totalIncome) * 100).toFixed(1)) : 0,
                wealthRate: totalIncome > 0 ? parseFloat(((totalSavings / totalIncome) * 100).toFixed(1)) : 0,
                status
            }
        }))

        return Response.json({
            months: enrichedMonths,
            totalMonths: enrichedMonths.length,
            currentMonth: currentMonthStr
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * POST /api/months
 * Auth: Required
 * Purpose: Start a new month setup
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['month', 'openingBalance', 'salary', 'rdAmount', 'sipAmount', 'chitAmount', 'efContribution']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const {
            month, openingBalance, salary,
            freelance, otherIncome,
            rdAmount, sipAmount,
            chitAmount, efContribution,
            salaryBankId
        } = body

        // 1. Validations
        if (!validateMonth(month)) return badRequestResponse("Invalid month format. Use: Mar '26")

        const amounts = [openingBalance, salary, freelance || 0, otherIncome || 0, rdAmount, sipAmount, chitAmount, efContribution]
        if (amounts.some(a => a < 0)) return badRequestResponse("All amounts must be >= 0")
        if (openingBalance <= 0) return badRequestResponse("openingBalance must be > 0")

        // 2. Check if month already exists
        const existing = await prisma.monthData.findUnique({
            where: { userId_month: { userId: user.userId, month } }
        })
        if (existing) {
            return Response.json(
                { error: "Conflict", message: "Month already started. Use PUT to update it." },
                { status: 409 }
            )
        }

        // 3. Derived calculation
        const totalSavings = rdAmount + sipAmount + chitAmount + efContribution
        const availableToSpend = openingBalance - totalSavings
        if (availableToSpend < 0) {
            return badRequestResponse("Savings exceed opening balance")
        }

        // 4. Transaction: Create month data + update bank + create balance record
        const result = await prisma.$transaction(async (tx) => {
            // a. Create MonthData
            const newMonth = await tx.monthData.create({
                data: {
                    userId: user.userId,
                    month,
                    openingBalance,
                    salary,
                    freelance: freelance || 0,
                    otherIncome: otherIncome || 0,
                    rdAmount,
                    sipAmount,
                    chitAmount,
                    efContribution,
                    savingsDeducted: false
                }
            })

            // b. Handle salary bank setup
            if (salaryBankId) {
                const bank = await tx.bankAccount.findFirst({
                    where: { id: salaryBankId, userId: user.userId }
                })
                if (!bank) throw new Error("Salary bank does not belong to you")

                await tx.bankAccount.update({
                    where: { id: salaryBankId },
                    data: { balance: openingBalance }
                })

                // c. Create opening balance record for bank
                await tx.monthlyBalance.upsert({
                    where: {
                        userId_bankId_month_balanceType: {
                            userId: user.userId,
                            bankId: salaryBankId,
                            month,
                            balanceType: 'opening'
                        }
                    },
                    update: { amount: openingBalance },
                    create: {
                        userId: user.userId,
                        bankId: salaryBankId,
                        month,
                        balanceType: 'opening',
                        amount: openingBalance,
                        note: "Initial opening balance from month setup"
                    }
                })
            }

            return newMonth
        })

        return Response.json({
            month: result,
            availableToSpend,
            transferChecklist: [
                { label: "RD / Flat DP", amount: rdAmount },
                { label: "SIP / MF", amount: sipAmount },
                { label: "Chit Fund", amount: chitAmount },
                { label: "Emergency Fund", amount: efContribution }
            ],
            message: "Month started successfully!"
        }, { status: 201 })

    } catch (error) {
        if (error.message === "Salary bank does not belong to you") {
            return Response.json({ error: "Forbidden", message: error.message }, { status: 403 })
        }
        return serverErrorResponse(error)
    }
}
