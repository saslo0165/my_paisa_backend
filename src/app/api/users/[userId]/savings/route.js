import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/middleware'
import { validateCreateSaving } from '@/lib/savings-validate'
import {
    getCurrentMonthIST,
    formatINR,
    buildSavingResponse,
    buildBankResponse,
    logSavingAttempt
} from '@/lib/savings-helpers'

export async function POST(request, { params }) {
    const startTime = Date.now()

    // Default values for logging in case we fail early
    let logData = {
        action: "create_saving",
        status: "failed",
        durationMs: 0
    }

    try {
        // STEP A — Extract and verify auth
        const decoded = requireAuth(request)
        if (!decoded) {
            return Response.json({
                error: "UNAUTHORIZED", message: "Missing or invalid token"
            }, { status: 401 })
        }

        const tokenUserId = decoded.userId
        const { userId: rawPathUserId } = await params
        const pathUserId = decodeURIComponent(rawPathUserId)

        logData.userId = tokenUserId
        logData.requestId = request.headers.get('x-request-id') || crypto.randomUUID()
        logData.ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1'

        if (tokenUserId !== pathUserId) {
            logData.failureReason = "Path userId doesn't match token"
            logSavingAttempt(logData)
            return Response.json({
                error: "FORBIDDEN",
                message: "You cannot access another user's savings"
            }, { status: 403 })
        }

        // STEP B — Check idempotency key
        const idempotencyKey = request.headers.get('Idempotency-Key')
        if (idempotencyKey) {
            logData.idempotencyKey = idempotencyKey

            const existingAudit = await prisma.savingAudit.findFirst({
                where: {
                    idempotencyKey,
                    status: "success",
                    userId: pathUserId
                },
                include: { saving: true }
            })

            if (existingAudit && existingAudit.saving) {
                logData.status = "duplicate_ignored"
                logData.durationMs = Date.now() - startTime
                logSavingAttempt(logData)

                return Response.json({
                    message: "Duplicate request — original saving returned",
                    saving: buildSavingResponse(existingAudit.saving),
                    isDuplicate: true
                }, { status: 200 })
            }
        }

        // STEP C — Validate request body
        const body = await request.json()
        logData.savingType = body.savingType
        logData.amountPaise = body.amountPaise
        logData.isOverride = body.isOverride || false

        const validation = validateCreateSaving(body)
        if (!validation.valid) {
            logData.failureReason = "VALIDATION_ERROR"
            logSavingAttempt(logData)
            return Response.json({
                error: "VALIDATION_ERROR",
                message: "Validation failed",
                fields: validation.errors
            }, { status: 422 })
        }

        // STEP D — Determine target month
        const targetMonth = body.month ?? getCurrentMonthIST()
        logData.month = targetMonth

        // STEP E — Fetch user
        const user = await prisma.user.findUnique({
            where: { id: pathUserId }
        })

        if (!user) {
            logData.failureReason = "USER_NOT_FOUND"
            logSavingAttempt(logData)
            return Response.json({
                error: "USER_NOT_FOUND",
                message: "User not found"
            }, { status: 404 })
        }

        // STEP F — Fetch current bank
        const bankId = user.currentBankId
        if (!bankId) {
            logData.failureReason = "NO_CURRENT_BANK"
            logSavingAttempt(logData)
            return Response.json({
                error: "NO_CURRENT_BANK",
                message: "No bank selected. Use POST /users/{userId}/banks/select to choose a bank first."
            }, { status: 404 })
        }

        logData.bankId = bankId

        const bank = await prisma.bank.findFirst({
            where: {
                id: bankId,
                userId: pathUserId,
                isActive: true
            }
        })

        if (!bank) {
            logData.failureReason = "BANK_NOT_FOUND"
            logSavingAttempt(logData)
            return Response.json({
                error: "BANK_NOT_FOUND",
                message: "Selected bank not found or has been deactivated."
            }, { status: 404 })
        }

        const balanceBefore = bank.balancePaise
        logData.balanceBefore = balanceBefore

        // STEP G — Check for duplicate saving type for this month
        const existingSaving = await prisma.saving.findUnique({
            where: {
                userId_month_savingType: {
                    userId: pathUserId,
                    month: targetMonth,
                    savingType: body.savingType
                }
            }
        })

        if (existingSaving) {
            logData.failureReason = "SAVING_EXISTS"
            logSavingAttempt(logData)
            return Response.json({
                error: "SAVING_EXISTS",
                message: "A saving of type '" + body.savingType + "' already exists for " + targetMonth,
                details: {
                    existingSavingId: existingSaving.id,
                    existingAmount: formatINR(existingSaving.amountPaise),
                    existingAmountPaise: existingSaving.amountPaise.toString()
                }
            }, { status: 409 })
        }

        // STEP H — Balance check pre-lock
        const requiredPaise = BigInt(body.amountPaise)
        const availablePaise = bank.balancePaise

        if (availablePaise < requiredPaise) {
            const shortfall = requiredPaise - availablePaise

            // Create FAILED audit record (outside transaction since it failed)
            await prisma.savingAudit.create({
                data: {
                    userId: pathUserId,
                    month: targetMonth,
                    amountPaise: requiredPaise,
                    bankId: bankId,
                    savingType: body.savingType,
                    status: "failed",
                    failureReason: "INSUFFICIENT_BALANCE",
                    bankBalanceBefore: balanceBefore,
                    bankBalanceAfter: null,
                    idempotencyKey: idempotencyKey ?? null,
                    isOverride: body.isOverride ?? false
                }
            })

            logData.failureReason = "INSUFFICIENT_BALANCE"
            logSavingAttempt(logData)

            return Response.json({
                error: "INSUFFICIENT_BALANCE",
                message: "Not enough balance in bank.",
                details: {
                    requiredPaise: requiredPaise.toString(),
                    requiredFormatted: formatINR(requiredPaise),
                    availablePaise: availablePaise.toString(),
                    availableFormatted: formatINR(availablePaise),
                    shortfallPaise: shortfall.toString(),
                    shortfallFormatted: formatINR(shortfall),
                    suggestion: "Add " + formatINR(shortfall) + " to your bank or reduce the saving amount"
                }
            }, { status: 400 })
        }

        // STEP I — Execute database transaction (Pessimistic Locking)
        try {
            const txResult = await prisma.$transaction(async (tx) => {
                // PART 1 — Lock bank row for update
                // Need to convert pathUserId to proper SQL uuid binding
                // Neon Postgres might require explicit casting depending on driver version, 
                // but usually Prisma tagged templates handle it nicely.
                const lockedBankArray = await tx.$queryRaw`
                    SELECT balance_paise 
                    FROM banks 
                    WHERE id = ${bankId}::uuid 
                    AND user_id = ${pathUserId}::uuid 
                    FOR UPDATE
                `

                if (!lockedBankArray || lockedBankArray.length === 0) {
                    throw new Error("Bank locked or not found during transaction")
                }

                // PART 2 — Re-verify balance inside lock
                const currentBalance = lockedBankArray[0].balance_paise
                if (currentBalance < requiredPaise) {
                    throw new Error("INSUFFICIENT_BALANCE_LOCKED")
                }

                // PART 3 — Create saving record
                const saving = await tx.saving.create({
                    data: {
                        userId: pathUserId,
                        bankId: bankId,
                        month: targetMonth,
                        amountPaise: requiredPaise,
                        savingType: body.savingType,
                        note: body.note ?? null,
                        isOverride: body.isOverride ?? false,
                        overrideReason: body.overrideReason ?? null,
                        idempotencyKey: idempotencyKey ?? null
                    }
                })

                // PART 4 — Deduct from bank balance
                const updatedBank = await tx.bank.update({
                    where: { id: bankId },
                    data: {
                        balancePaise: {
                            decrement: requiredPaise
                        }
                    }
                })

                // PART 5 — Create SUCCESS audit record
                await tx.savingAudit.create({
                    data: {
                        userId: pathUserId,
                        savingId: saving.id,
                        month: targetMonth,
                        amountPaise: requiredPaise,
                        bankId: bankId,
                        savingType: body.savingType,
                        status: "success",
                        bankBalanceBefore: balanceBefore,
                        bankBalanceAfter: updatedBank.balancePaise,
                        idempotencyKey: idempotencyKey ?? null,
                        isOverride: body.isOverride ?? false,
                        overrideReason: body.overrideReason ?? null,
                        ipAddress: logData.ipAddress
                    }
                })

                return { saving, updatedBank }
            })

            // STEP J — Log success and return
            logData.status = "success"
            logData.balanceAfter = txResult.updatedBank.balancePaise
            logData.durationMs = Date.now() - startTime
            delete logData.failureReason
            logSavingAttempt(logData)

            return Response.json({
                message: "Saving recorded successfully",
                saving: buildSavingResponse(txResult.saving),
                bank: buildBankResponse(txResult.updatedBank),
                balanceBefore: balanceBefore.toString(),
                balanceBeforeFormatted: formatINR(balanceBefore),
                balanceAfter: txResult.updatedBank.balancePaise.toString(),
                balanceAfterFormatted: formatINR(txResult.updatedBank.balancePaise),
                deducted: {
                    amountPaise: requiredPaise.toString(),
                    amountFormatted: formatINR(requiredPaise)
                }
            }, { status: 201 })

        } catch (txError) {
            if (txError.message === "INSUFFICIENT_BALANCE_LOCKED") {
                // Someone successfully drained this bank between our outer check and the row lock
                logData.failureReason = "INSUFFICIENT_BALANCE_RACE_CONDITION"
                logSavingAttempt(logData)

                // Recalculate shortfall for accurate error message based on fresh locked fetch
                // We'd have to re-fetch the bank to see the new balance outside the transaction,
                // but we can just throw a generic error for now based on the spec
                const currentBankState = await prisma.bank.findUnique({ where: { id: bankId } })
                const newAvailable = currentBankState ? currentBankState.balancePaise : 0n
                const newShortfall = requiredPaise - newAvailable

                return Response.json({
                    error: "INSUFFICIENT_BALANCE",
                    message: "Not enough balance in bank.",
                    details: {
                        requiredPaise: requiredPaise.toString(),
                        requiredFormatted: formatINR(requiredPaise),
                        availablePaise: newAvailable.toString(),
                        availableFormatted: formatINR(newAvailable),
                        shortfallPaise: newShortfall.toString(),
                        shortfallFormatted: formatINR(newShortfall),
                        suggestion: "Add " + formatINR(newShortfall) + " to your bank or reduce the saving amount"
                    }
                }, { status: 400 })
            }
            throw txError // Let catch(error) handle everything else
        }

    } catch (error) {
        logData.failureReason = error.message
        logSavingAttempt(logData)

        console.error("POST /api/users/[userId]/savings Error:", error)
        return Response.json({
            error: "SERVER_ERROR",
            message: "An unexpected error occurred",
            details: process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}
        }, { status: 500 })
    }
}
