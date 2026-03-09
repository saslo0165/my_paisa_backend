import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse } from '@/lib/middleware'
import { encryptText } from '@/lib/encrypt'

/**
 * PUT /api/banks/:id
 * Auth: Required
 * Purpose: Update bank details
 */
export async function PUT(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params
        const body = await request.json()

        // Find bank where id AND userId match (security)
        const bank = await prisma.bankAccount.findFirst({
            where: { id, userId: user.userId }
        })

        if (!bank) return notFoundResponse("Bank account")

        // Prepare update data
        const updateData = { ...body }
        if (body.accountNumber) {
            updateData.accountNumber = encryptText(body.accountNumber)
        }
        // ifscCode removed from schema

        const updatedBank = await prisma.bankAccount.update({
            where: { id },
            data: updateData
        })

        return Response.json(updatedBank)
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * DELETE /api/banks/:id
 * Auth: Required
 * Purpose: Delete a bank account
 */
export async function DELETE(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params

        // Find bank where id AND userId match
        const bank = await prisma.bankAccount.findFirst({
            where: { id, userId: user.userId },
            include: { _count: { select: { expenses: true } } }
        })

        if (!bank) return notFoundResponse("Bank account")

        // In a real app, we might want to use a transaction to set bankId to null 
        // on related expenses before deleting.
        await prisma.$transaction(async (tx) => {
            // Set bankId to null on related expenses
            await tx.expense.updateMany({
                where: { bankId: id },
                data: { bankId: null }
            })

            // Delete related MonthlyBalance records
            await tx.monthlyBalance.deleteMany({
                where: { bankId: id }
            })

            // Delete the bank
            await tx.bankAccount.delete({
                where: { id }
            })
        })

        return Response.json({ message: "Bank account deleted successfully" })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
