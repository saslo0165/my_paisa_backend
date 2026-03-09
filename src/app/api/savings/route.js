import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateRequired, validateMonth } from '@/lib/validate'
import { toPaise, jsonResponse } from '@/lib/currency'

/**
 * GET /api/savings
 * Auth: Required
 * Purpose: Fetch savings records for a specific month
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const { searchParams } = new URL(request.url)
        const month = searchParams.get('month')

        if (!month) {
            return badRequestResponse("month query parameter is required (e.g., '2026-03')")
        }

        const savings = await prisma.saving.findMany({
            where: { userId: user.userId, month: month },
            include: {
                bank: {
                    select: { bankName: true, nickname: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        })

        const totalSavedPaise = savings.reduce((sum, s) => sum + s.amountPaise, 0n)

        return jsonResponse({
            month,
            savings,
            totalSavedPaise
        })

    } catch (error) {
        console.error("GET /api/savings Error:", error)
        return serverErrorResponse(error)
    }
}

/**
 * POST /api/savings
 * Auth: Required
 * Purpose: Record a new saving, deduct bank balance, create audit trail
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['bankId', 'month', 'amount', 'savingType']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const { bankId, month, amount, savingType, note, isOverride, idempotencyKey } = body

        // 1. Validation
        // Month must be YYYY-MM per schema check
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return badRequestResponse("Invalid month format. Must be YYYY-MM")
        }

        const validTypes = ['rd', 'sip', 'chit', 'ef', 'custom']
        if (!validTypes.includes(savingType)) {
            return badRequestResponse("savingType must be one of: rd, sip, chit, ef, custom")
        }

        if (typeof amount !== 'number' || amount <= 0) {
            return badRequestResponse("Amount must be greater than 0")
        }

        const amountPaise = toPaise(amount)

        // 2. Fetch Bank
        const bank = await prisma.bank.findFirst({
            where: { id: bankId, userId: user.userId }
        })

        if (!bank) return badRequestResponse("Bank account not found or does not belong to you")

        const bankBalanceBefore = bank.balancePaise

        // 3. Idempotency / Duplicate Check
        if (idempotencyKey) {
            const existingAudit = await prisma.savingAudit.findFirst({
                where: { idempotencyKey, userId: user.userId }
            })
            if (existingAudit && existingAudit.status === 'success') {
                return jsonResponse({ message: "Duplicate request ignored", savingAudit: existingAudit })
            }
        }

        // Unique constraint check (one type per month)
        const existingSaving = await prisma.saving.findUnique({
            where: { userId_month_savingType: { userId: user.userId, month, savingType } }
        })

        if (existingSaving) {
            // Log failed audit
            await prisma.savingAudit.create({
                data: {
                    userId: user.userId,
                    month,
                    amountPaise,
                    bankId,
                    savingType,
                    status: 'failed',
                    failureReason: `Saving of type ${savingType} already exists for month ${month}`,
                    bankBalanceBefore,
                    isOverride: isOverride || false,
                    idempotencyKey
                }
            })
            return badRequestResponse(`Saving of type ${savingType} already exists for month ${month}`)
        }

        // 4. Verify Balance
        if (bankBalanceBefore < amountPaise) {
            // Log failed audit
            await prisma.savingAudit.create({
                data: {
                    userId: user.userId,
                    month,
                    amountPaise,
                    bankId,
                    savingType,
                    status: 'failed',
                    failureReason: "Insufficient bank balance",
                    bankBalanceBefore,
                    isOverride: isOverride || false,
                    idempotencyKey
                }
            })
            return badRequestResponse("Insufficient bank balance")
        }

        // 5. Transaction: Create Saving, Deduct Bank, Create Audit
        const result = await prisma.$transaction(async (tx) => {
            const newSaving = await tx.saving.create({
                data: {
                    userId: user.userId,
                    bankId,
                    month,
                    amountPaise,
                    savingType,
                    note,
                    isOverride: isOverride || false,
                    idempotencyKey
                }
            })

            const updatedBank = await tx.bank.update({
                where: { id: bankId },
                data: { balancePaise: { decrement: amountPaise } }
            })

            const newAudit = await tx.savingAudit.create({
                data: {
                    userId: user.userId,
                    savingId: newSaving.id,
                    month,
                    amountPaise,
                    bankId,
                    savingType,
                    status: 'success',
                    bankBalanceBefore,
                    bankBalanceAfter: updatedBank.balancePaise,
                    isOverride: isOverride || false,
                    idempotencyKey
                }
            })

            return { saving: newSaving, bank: updatedBank, audit: newAudit }
        })

        return jsonResponse({
            message: "Saving recorded successfully",
            saving: result.saving,
            newBankBalancePaise: result.bank.balancePaise
        }, { status: 201 })

    } catch (error) {
        console.error("POST /api/savings Error:", error)
        return serverErrorResponse(error)
    }
}
