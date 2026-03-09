import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateRequired, validateAmount } from '@/lib/validate'

/**
 * GET /api/cards
 * Auth: Required
 * Purpose: Get all credit cards for user with calculated fields
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const cards = await prisma.creditCard.findMany({
            where: { userId: user.userId },
            orderBy: { createdAt: 'desc' }
        })

        const today = new Date().getDate()

        // Add calculated fields
        const processedCards = cards.map(card => {
            // Simple logic for days until due (this month or next)
            let daysUntilDue = card.dueDate - today
            if (daysUntilDue < 0) {
                // If today is 10th and due is 5th, daysUntilDue = -5
                // Assuming next month's 5th
                daysUntilDue += 30 // Approximate
            }

            const isUrgent = daysUntilDue <= 3 && card.outstandingBill > 0
            const utilizationPct = card.creditLimit > 0 ? (card.cycleSpend / card.creditLimit) * 100 : 0

            return {
                ...card,
                daysUntilDue,
                isUrgent,
                utilizationPct: parseFloat(utilizationPct.toFixed(2))
            }
        })

        // Order by isUrgent first
        processedCards.sort((a, b) => (b.isUrgent === a.isUrgent) ? 0 : b.isUrgent ? 1 : -1)

        return Response.json(processedCards)
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * POST /api/cards
 * Auth: Required
 * Purpose: Add new credit card
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['bankName', 'nickname', 'billingDate', 'dueDate', 'creditLimit']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const { bankName, nickname, billingDate, dueDate, creditLimit } = body

        // Validation for dates and limit
        if (billingDate < 1 || billingDate > 31) return badRequestResponse("Billing date must be between 1 and 31")
        if (dueDate < 1 || dueDate > 31) return badRequestResponse("Due date must be between 1 and 31")
        if (!validateAmount(creditLimit)) return badRequestResponse("Credit limit must be a positive number")

        const newCard = await prisma.creditCard.create({
            data: {
                userId: user.userId,
                bankName,
                nickname,
                billingDate,
                dueDate,
                creditLimit,
                outstandingBill: 0,
                cycleSpend: 0
            }
        })

        return Response.json(newCard, { status: 201 })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
