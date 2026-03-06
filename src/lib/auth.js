import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d'

/**
 * Creates an Access Token valid for 15 minutes
 * Like a temporary entry pass to a building.
 */
export function generateAccessToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

/**
 * Creates a Refresh Token valid for 30 days
 * Used to get a new Access Token without logging in again.
 */
export function generateRefreshToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN })
}

/**
 * Verifies if a token is valid
 * Checks if the signature matches and it's not expired.
 */
export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET)
    } catch (error) {
        return null
    }
}

/**
 * Extracts the user ID from the Request headers
 * Reads "Authorization: Bearer <token>"
 */
export function getUserFromRequest(request) {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null
    }

    const token = authHeader.split(' ')[1]
    return verifyToken(token)
}
