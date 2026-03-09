import prisma from '@/lib/prisma'
import { requireAuth, unauthorizedResponse, serverErrorResponse, badRequestResponse } from '@/lib/middleware'
import { validateAmount } from '@/lib/validate'

/**
 * GET /api/user/settings
 * Auth: Required
 * Purpose: Get current user settings
 */
export async function GET(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const settings = await prisma.userSettings.findUnique({
            where: { userId: user.userId }
        })

        return Response.json(settings)
    } catch (error) {
        return serverErrorResponse(error)
    }
}

/**
 * PUT /api/user/settings
 * Auth: Required
 * Purpose: Update user settings
 * Body: { monthlySalary, savingsPct, efTargetMonths, ... }
 */
export async function PUT(request) {
    try {
        const user = requireAuth(request)
        if (!user) return unauthorizedResponse()

        const body = await request.json()
        const {
            monthlySalary, savingsPct, efTargetMonths,
            flatDpTarget, defaultRd, defaultSip,
            defaultChit, defaultEf
        } = body

        // Validate all provided amounts are positive numbers
        const amountsToValidate = {
            monthlySalary, savingsPct, efTargetMonths,
            flatDpTarget, defaultRd, defaultSip,
            defaultChit, defaultEf
        }

        for (const [key, value] of Object.entries(amountsToValidate)) {
            if (value !== undefined && !validateAmount(value)) {
                // savingsPct can be 0 or small decimal, but validateAmount checks > 0
                // For pct, we might allow 0
                if (key === 'savingsPct' && value >= 0) continue
                return badRequestResponse(`Invalid value for ${key}. Must be a positive number.`)
            }
        }

        // Update UserSettings using Prisma upsert
        const updatedSettings = await prisma.userSettings.upsert({
            where: { userId: user.userId },
            update: {
                monthlySalary, savingsPct, efTargetMonths,
                flatDpTarget, defaultRd, defaultSip,
                defaultChit, defaultEf
            },
            create: {
                userId: user.userId,
                monthlySalary: monthlySalary || 56000,
                savingsPct: savingsPct || 0.30,
                efTargetMonths: efTargetMonths || 6,
                flatDpTarget: flatDpTarget || 200000,
                defaultRd: defaultRd || 13000,
                defaultSip: defaultSip || 500,
                defaultChit: defaultChit || 2000,
                defaultEf: defaultEf || 5000
            }
        })

        return Response.json(updatedSettings)
    } catch (error) {
        return serverErrorResponse(error)
    }
}
