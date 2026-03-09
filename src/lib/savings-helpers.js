/**
 * Helper functions for the Monthly Savings API
 * Handles currency formatting, date manipulation, and response building.
 */

/**
 * Convert paise to formatted rupee string (e.g., 1300000 -> "₹13,000.00")
 * @param {bigint|number|string} paise - Amount in minor units (paise)
 * @returns {string} Formatted Indian Rupee string
 */
export function formatINR(paise) {
    const rupees = Number(paise) / 100
    return "₹" + rupees.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })
}

/**
 * Get current month in YYYY-MM format using India Standard Time (UTC+5:30)
 * @returns {string} Current month string like "2026-03"
 */
export function getCurrentMonthIST() {
    const now = new Date()
    const istDate = new Date(
        now.toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata'
        })
    )
    const year = istDate.getFullYear()
    const month = String(istDate.getMonth() + 1).padStart(2, '0')
    return year + '-' + month
}

/**
 * Validate month string format YYYY-MM
 * @param {string} month - Month string to validate
 * @returns {{valid: boolean, message?: string}} Validation result
 */
export function validateMonth(month) {
    if (!month) return { valid: false, message: "month is required" }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return { valid: false, message: "month must be in YYYY-MM format. Example: 2026-03" }
    }

    return { valid: true }
}

/**
 * Check if the saving type is a valid option
 * @param {string} type - The saving type string
 * @returns {boolean} True if valid enum value
 */
export function validateSavingType(type) {
    const validTypes = ['rd', 'sip', 'chit', 'ef', 'custom']
    return validTypes.includes(type)
}

/**
 * Check if the provided month is in the future compared to current IST month
 * @param {string} month - Target month in YYYY-MM format
 * @returns {boolean} True if month is in the future
 */
export function isFutureMonth(month) {
    const current = getCurrentMonthIST()
    return month > current
}

/**
 * Check if the provided month is the current IST month
 * @param {string} month - Target month in YYYY-MM format
 * @returns {boolean} True if month is current month
 */
export function isCurrentMonth(month) {
    return month === getCurrentMonthIST()
}

/**
 * Check if the provided month is in the past compared to current IST month
 * @param {string} month - Target month in YYYY-MM format
 * @returns {boolean} True if month is in the past
 */
export function isPastMonth(month) {
    return !isCurrentMonth(month) && !isFutureMonth(month)
}

/**
 * Safely format a Saving object to be returned in API response, handling BigInts
 * @param {Object} saving - The Prisma saving object
 * @returns {Object} API-ready saving object
 */
export function buildSavingResponse(saving) {
    return {
        id: saving.id,
        userId: saving.userId,
        bankId: saving.bankId,
        month: saving.month,
        amountPaise: saving.amountPaise.toString(),
        amountFormatted: formatINR(saving.amountPaise),
        savingType: saving.savingType,
        note: saving.note,
        isOverride: saving.isOverride,
        overrideReason: saving.overrideReason,
        idempotencyKey: saving.idempotencyKey,
        createdAt: saving.createdAt
    }
}

/**
 * Safely format a Bank object to be returned in API response, handling BigInts
 * @param {Object} bank - The Prisma bank object
 * @returns {Object} API-ready bank object
 */
export function buildBankResponse(bank) {
    return {
        id: bank.id,
        userId: bank.userId,
        bankName: bank.bankName,
        nickname: bank.nickname,
        accountType: bank.accountType,
        isActive: bank.isActive,
        balancePaise: bank.balancePaise.toString(),
        balanceFormatted: formatINR(bank.balancePaise)
    }
}

/**
 * Structured console log for observability of saving attempts
 * @param {Object} data - Audit details of the attempt
 */
export function logSavingAttempt(data) {
    const logData = {
        timestamp: new Date().toISOString(),
        ...data,
        amountINR: data.amountPaise !== undefined ? formatINR(data.amountPaise) : undefined,
    }

    console.log(JSON.stringify(logData, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ))
}
