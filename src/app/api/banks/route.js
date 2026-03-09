import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { encryptText, maskAccountNumber } from '@/lib/encrypt'
import { validateRequired } from '@/lib/validate'
import { toPaise, jsonResponse } from '@/lib/currency'

/**
 * GET /api/banks
 * Auth: Required
 * Purpose: Get all banks for logged in user
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const banks = await prisma.bank.findMany({
            where: { userId: user.userId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { expenses: true, savings: true }
                }
            }
        })

        // Mask account numbers before returning
        const processedBanks = banks.map(bank => ({
            ...bank,
            accountNumber: maskAccountNumber(bank.accountNumber)
        }))

        // Calculate total balance sum in paise (BigInt)
        const totalBalancePaise = processedBanks.reduce((sum, bank) => sum + (bank.balancePaise || 0n), 0n)

        // jsonResponse will safely serialize the BigInts to standard Javascript Numbers
        return jsonResponse({
            banks: processedBanks,
            totalBalancePaise
        })
    } catch (error) {
        console.error("GET /api/banks Error:", error)
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
            accountType, nickname,
            initialBalance // Assuming input is still in Rupees (float) for backward compatibility
        } = body

        // Encrypt accountNumber before saving
        const encryptedAccountNumber = encryptText(accountNumber)

        // Auto-generate nickname if not provided
        const finalNickname = nickname || `${bankName} ${accountType}`

        const newBank = await prisma.bank.create({
            data: {
                userId: user.userId,
                bankName,
                accountNumber: encryptedAccountNumber,
                holderName,
                accountType,
                nickname: finalNickname,
                balancePaise: toPaise(initialBalance || 0)
            }
        })

        // Return created bank with masked account number
        return jsonResponse({
            ...newBank,
            accountNumber: maskAccountNumber(accountNumber)
        }, { status: 201 })
    } catch (error) {
        console.error("POST /api/banks Error:", error)
        return serverErrorResponse(error)
    }
}
