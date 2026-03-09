import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, notFoundResponse } from '@/lib/middleware'
import { jsonResponse } from '@/lib/currency'

/**
 * DELETE /api/savings/:id
 * Auth: Required
 * Purpose: Delete a recorded saving, refund bank balance, create audit trail
 */
export async function DELETE(request, { params }) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { id } = await params

        // 1. Fetch saving
        const saving = await prisma.saving.findFirst({
            where: { id, userId: user.userId },
            include: { bank: true }
        })

        if (!saving) return notFoundResponse("Saving record")

        const bankBalanceBefore = saving.bank.balancePaise
        const amountPaise = saving.amountPaise

        // 2. Transaction: Refund bank, delete saving, create audit for reversal
        const result = await prisma.$transaction(async (tx) => {

            // Refund the bank (increment back the savings)
            const updatedBank = await tx.bank.update({
                where: { id: saving.bankId },
                data: { balancePaise: { increment: amountPaise } }
            })

            // IMPORTANT: Since an audit is uniquely tied to a savingId (1-to-1 or 1-to-null),
            // and we are deleting the saving, we must either:
            // A) Set the original success audit to failed/reversed
            // B) Or just update relations and store the deletion audit against the user 
            // without a direct savingId constraint since the saving is gone.

            // Let's create a NEW audit logging the reversal, with savingId as null 
            // since the row is about to be deleted.
            const reversalAudit = await tx.savingAudit.create({
                data: {
                    userId: user.userId,
                    month: saving.month,
                    amountPaise: amountPaise,
                    bankId: saving.bankId,
                    savingType: saving.savingType,
                    status: 'success', // Reversal was successful
                    bankBalanceBefore: bankBalanceBefore,
                    bankBalanceAfter: updatedBank.balancePaise,
                    overrideReason: 'User deleted saving record manually',
                    isOverride: true
                }
            })

            // Now we must delete the original audit(s) tied to this saving, 
            // otherwise foreign key constraint fails when we delete the saving.
            await tx.savingAudit.deleteMany({
                where: { savingId: id }
            })

            // Delete the saving
            await tx.saving.delete({
                where: { id }
            })

            return { bank: updatedBank, audit: reversalAudit }
        })

        return jsonResponse({
            message: "Saving deleted successfully and bank balance refunded",
            newBankBalancePaise: result.bank.balancePaise
        })

    } catch (error) {
        console.error("DELETE /api/savings/:id Error:", error)
        return serverErrorResponse(error)
    }
}
