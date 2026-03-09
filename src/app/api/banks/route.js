import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { encryptText, maskAccountNumber } from '@/lib/encrypt'
import { validateRequired } from '@/lib/validate'

/**
 * GET /api/banks
 * Auth: Required
 * Purpose: Get all banks for logged in user
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const banks = await prisma.bankAccount.findMany({
            where: { userId: user.userId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { expenses: true }
                }
            }
        })

        // Mask account numbers before returning
        const processedBanks = banks.map(bank => ({
            ...bank,
            accountNumber: maskAccountNumber(bank.accountNumber)
        }))

        // Calculate total balance sum
        // Note: For now, we don't have a 'balance' field in BankAccount, 
        // but Milestone 6 mentions opening/closing balances.
        // Let's assume we sum current balances if we added that field, 
        // but looking at Step 1, we didn't add a 'balance' field to BankAccount.
        // However, Step 4 says "Also return total balance sum".
        // I should probably add a balance field if it's needed for calculations.
        // Wait, the user request for BankAccount model in Step 1 DID NOT have balance.
        // But Step 7 (Expenses) says "Deduct amount from bank balance".
        // I will add a `balance Float @default(0)` to BankAccount model now.

        const totalBalance = processedBanks.reduce((sum, bank) => sum + (bank.balance || 0), 0)

        return Response.json({
            banks: processedBanks,
            totalBalance
        })
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * POST /api/banks
 * Auth: Required
 * Purpose: Add new bank account
 */
export async function POST(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const required = ['bankName', 'accountNumber', 'holderName', 'accountType']
        const missing = validateRequired(required, body)

        if (missing.length > 0) {
            return badRequestResponse(`Missing required fields: ${missing.join(', ')}`)
        }

        const {
            bankName, accountNumber, holderName,
            accountType, ifscCode, branchAddress, nickname,
            initialBalance
        } = body

        // Encrypt accountNumber before saving
        const encryptedAccountNumber = encryptText(accountNumber)

        // Auto-generate nickname if not provided
        const finalNickname = nickname || `${bankName} ${accountType}`

        const newBank = await prisma.bankAccount.create({
            data: {
                userId: user.userId,
                bankName,
                accountNumber: encryptedAccountNumber,
                holderName,
                accountType,
                ifscCode: ifscCode?.toUpperCase(),
                branchAddress,
                nickname: finalNickname,
                balance: initialBalance || 0
            }
        })

        // Return created bank with masked account number
        return Response.json({
            ...newBank,
            accountNumber: maskAccountNumber(accountNumber)
        }, { status: 201 })
    } catch (error) {
        return serverErrorResponse(error)
    }
}
