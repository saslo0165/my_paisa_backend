import prisma from '@/lib/prisma'
import { generateAccessToken, generateRefreshToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(request) {
    try {
        // 1. Parse request body (like parsing JSON in Flutter)
        const body = await request.json()
        const { name, email, phone, password } = body

        // 2. Simple validation (Validation is key in backend!)
        if (!name || !email || !password) {
            return Response.json({
                error: "Name, Email, and Password are required"
            }, { status: 400 })
        }

        // 3. Check if user already exists
        // We avoid duplicates for cleanliness
        const existingUser = await prisma.user.findUnique({
            where: { email }
        })

        if (existingUser) {
            return Response.json({
                error: "Email already registered"
            }, { status: 409 })
        }

        // 4. Hash password (NEVER store plain text passwords!)
        // 12 rounds of salt makes it very secure
        const hashedPassword = await bcrypt.hash(password, 12)

        // 5. Create user and default settings in a Transaction
        // A transaction ensures BOTH happen or NEITHER happens
        const user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    name,
                    email,
                    phone,
                    password: hashedPassword,
                    // Automatically create settings for the user
                    settings: {
                        create: {} // Uses defaults defined in schema
                    }
                },
                include: {
                    settings: true
                }
            })
            return newUser
        })

        // 6. Generate tokens
        const accessToken = generateAccessToken(user.id)
        const refreshToken = generateRefreshToken(user.id)

        // 7. Remove sensitive fields before returning
        const { password: _, ...userWithoutPassword } = user

        return Response.json({
            message: "User registered successfully",
            user: userWithoutPassword,
            accessToken,
            refreshToken
        }, { status: 201 })

    } catch (error) {
        console.error('Registration Error:', error)
        return Response.json({
            error: "Something went wrong on the server"
        }, { status: 500 })
    }
}
