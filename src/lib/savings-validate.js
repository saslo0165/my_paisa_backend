import { validateMonth, validateSavingType, isFutureMonth, isPastMonth } from './savings-helpers'

/**
 * Validates POST /savings request body.
 * @param {Object} body - Request payload
 * @returns {{valid: boolean, errors?: string[]}} 
 */
export function validateCreateSaving(body) {
    const errors = []

    // 1. amountPaise exists
    if (body.amountPaise === undefined || body.amountPaise === null) {
        errors.push("amountPaise is required")
    } else {
        // 2. amountPaise is integer
        if (!Number.isInteger(body.amountPaise)) {
            errors.push("amountPaise must be an integer (amount in paise, e.g. ₹13000 = 1300000)")
        } else {
            // 3. amountPaise > 0
            if (body.amountPaise <= 0) {
                errors.push("amountPaise must be greater than 0")
            }
        }
    }

    // 4. savingType exists
    if (!body.savingType) {
        errors.push("savingType is required")
    } else {
        // 5. savingType is valid enum
        if (!validateSavingType(body.savingType)) {
            errors.push("savingType must be one of: rd, sip, chit, ef, custom")
        }
    }

    // 6. If month provided:
    if (body.month) {
        const monthCheck = validateMonth(body.month)
        if (!monthCheck.valid) {
            errors.push("month must be in YYYY-MM format. Example: 2026-03")
        } else {
            // 7. If month is future
            if (isFutureMonth(body.month)) {
                errors.push("Cannot save for a future month")
            }

            // 8. If month is past (override):
            if (isPastMonth(body.month)) {
                if (body.isOverride !== true) {
                    errors.push("Set isOverride: true for past months")
                } else if (!body.overrideReason || body.overrideReason.trim() === '') {
                    errors.push("overrideReason is required when saving for a past month")
                }
            }
        }
    }

    // 9. If note provided: Validate length <= 500 chars
    if (body.note && body.note.length > 500) {
        errors.push("note cannot exceed 500 characters")
    }

    if (errors.length > 0) {
        return { valid: false, errors }
    }

    return { valid: true }
}
