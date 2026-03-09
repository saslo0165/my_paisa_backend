import CryptoJS from 'crypto-js'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

/**
 * Encrypt sensitive data before storing in DB.
 * Like hiding a password, we store a scrambled version in the database.
 */
export function encryptText(text) {
    if (!text) return null
    if (!ENCRYPTION_KEY) {
        console.error("ENCRYPTION_KEY is not defined in environment variables")
        return text // Fallback to plain text if key is missing (not ideal for production)
    }
    const strText = String(text)
    return CryptoJS.AES.encrypt(strText, ENCRYPTION_KEY).toString()
}

/**
 * Decrypt data when reading from DB.
 */
export function decryptText(encrypted) {
    if (!encrypted) return null
    if (!ENCRYPTION_KEY) return encrypted
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY)
        return bytes.toString(CryptoJS.enc.Utf8)
    } catch (error) {
        console.error("Decryption failed:", error)
        return null
    }
}

/**
 * Mask account number for display purposes.
 * Input: "1234567890123456"
 * Output: "XXXX XXXX XXXX 3456"
 */
export function maskAccountNumber(accountNumber) {
    if (!accountNumber) return "XXXX"
    const strMatch = String(accountNumber)
    const last4 = strMatch.slice(-4)
    return `XXXX XXXX XXXX ${last4}`
}
