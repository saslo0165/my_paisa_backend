import prisma from '@/lib/prisma'
import { generateAccessToken, generateRefreshToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(request) {
    try {
        const { email, password } = await request.json()

        // 1. Validation
        if (!email || !password) {
            return Response.json({
                error: "Email and password are required"
            }, { status: 400 })
        }

        // 2. Find user by email
        const user = await prisma.user.findUnique({
            where: { email },
            include: { settings: true }
        })

        // 3. User not found
        if (!user) {
            // Security Tip: Use generic message so attackers don't know
            // which part of the login failed (email or password).
            return Response.json({
                error: "Invalid email or password"
            }, { status: 401 })
        }

        // 4. Compare passwords using bcrypt
        const isPasswordValid = await bcrypt.compare(password, user.password)

        if (!isPasswordValid) {
            return Response.json({
                error: "Invalid email or password"
            }, { status: 401 })
        }

        // 5. Generate new tokens
        const accessToken = generateAccessToken(user.id)
        const refreshToken = generateRefreshToken(user.id)

        // 6. Return user data (without password) and tokens
        const { password: _, ...userWithoutPassword } = user

        return Response.json({
            message: "Login successful",
            user: userWithoutPassword,
            accessToken,
            refreshToken
        }, { status: 200 })

    } catch (error) {
        console.error('Login Error:', error)
        return Response.json({
            error: "Something went wrong on the server"
        }, { status: 500 })
    }
}
