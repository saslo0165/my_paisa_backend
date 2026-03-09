/**
 * Input validation helper functions.
 * Like Form validation in Flutter, but on the server side.
 */

/**
 * Validate email format
 */
export function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return regex.test(email)
}

/**
 * Validate 10 digit Indian mobile number
 * Must start with 6, 7, 8 or 9
 */
export function validatePhone(phone) {
    const regex = /^[6-9]\d{9}$/
    return regex.test(phone)
}

/**
 * Validate if amount is a number and greater than 0
 */
export function validateAmount(amount) {
    return typeof amount === 'number' && amount > 0
}

/**
 * Validate month format matches "Mar '26"
 */
export function validateMonth(month) {
    const regex = /^[A-Z][a-z]{2} '\d{2}$/
    return regex.test(month)
}

/**
 * Checks if required fields are present in the body
 * Returns array of missing field names
 */
export function validateRequired(fields, body) {
    const missing = []
    fields.forEach(field => {
        if (body[field] === undefined || body[field] === null || body[field] === '') {
            missing.push(field)
        }
    })
    return missing
}
