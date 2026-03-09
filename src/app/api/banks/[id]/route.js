import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse } from '@/lib/middleware'
import { encryptText } from '@/lib/encrypt'
import { jsonResponse } from '@/lib/currency'

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
        const bank = await prisma.bank.findFirst({
            where: { id, userId: user.userId }
        })

        if (!bank) return notFoundResponse("Bank account")

        // Prepare update data
        const updateData = { ...body }
        if (body.accountNumber) {
            updateData.accountNumber = encryptText(body.accountNumber)
        }

        // Remove balancePaise from body if they try to update balance directly
        // Balance should be updated via transactions/expenses/savings
        delete updateData.balancePaise
        delete updateData.initialBalance
        delete updateData.balance

        const updatedBank = await prisma.bank.update({
            where: { id },
            data: updateData
        })

        return jsonResponse(updatedBank)
    } catch (error) {
        console.error("PUT /api/banks/:id Error:", error)
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
        const bank = await prisma.bank.findFirst({
            where: { id, userId: user.userId },
            include: { _count: { select: { expenses: true, savings: true } } }
        })

        if (!bank) return notFoundResponse("Bank account")

        await prisma.$transaction(async (tx) => {
            // Unlink expenses
            await tx.expense.updateMany({
                where: { bankId: id },
                data: { bankId: null }
            })

            // Delete MonthlyBalance records
            await tx.monthlyBalance.deleteMany({
                where: { bankId: id }
            })

            // Fetch related savings to delete their audits first
            const savings = await tx.saving.findMany({
                where: { bankId: id },
                select: { id: true }
            })
            const savingIds = savings.map(s => s.id)

            // Delete saving audits linked to this bank OR these savings
            if (savingIds.length > 0) {
                await tx.savingAudit.deleteMany({
                    where: {
                        OR: [
                            { bankId: id },
                            { savingId: { in: savingIds } }
                        ]
                    }
                })
            } else {
                await tx.savingAudit.deleteMany({ where: { bankId: id } })
            }

            // Delete savings
            await tx.saving.deleteMany({
                where: { bankId: id }
            })

            // Finally, delete the bank
            await tx.bank.delete({
                where: { id }
            })
        })

        return jsonResponse({ message: "Bank account deleted successfully" })
    } catch (error) {
        console.error("DELETE /api/banks/:id Error:", error)
        return serverErrorResponse(error)
    }
}
