import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse } from '@/lib/middleware'

/**
 * PUT /api/cards/:id
 * Auth: Required
 * Purpose: Update card details
 */
export async function PUT(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = params
        const body = await request.json()

        const card = await prisma.creditCard.findFirst({
            where: { id, userId: user.userId }
        })

        if (!card) return notFoundResponse("Credit card")

        const updatedCard = await prisma.creditCard.update({
            where: { id },
            data: body
        })

        return Response.json(updatedCard)
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * DELETE /api/cards/:id
 * Auth: Required
 * Purpose: Delete credit card
 */
export async function DELETE(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = params

        const card = await prisma.creditCard.findFirst({
            where: { id, userId: user.userId }
        })

        if (!card) return notFoundResponse("Credit card")

        await prisma.creditCard.delete({
            where: { id }
        })

        return Response.json({ message: "Credit card deleted successfully" })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
