import { getUserFromRequest } from './auth.js'

/**
 * Reusable auth checker for all protected routes.
 * Instead of copying auth check in every route, call this one function.
 * 
 * Flutter Comparison: This is like an Interceptor or Middleware
 * that checks for a valid session before allowing the request to proceed.
 */
export function requireAuth(request) {
    const user = getUserFromRequest(request)
    return user // Returns decoded { userId } or null
}

/**
 * Returns standard 401 JSON response
 */
export function unauthorizedResponse() {
    return Response.json(
        { error: "Unauthorized", message: "Please login" },
        { status: 401 }
    )
}

/**
 * Returns standard 404 JSON response
 */
export function notFoundResponse(resource) {
    return Response.json(
        { error: "Not found", message: `${resource} not found` },
        { status: 404 }
    )
}

/**
 * Returns standard 400 JSON response
 */
export function badRequestResponse(message) {
    return Response.json(
        { error: "Bad request", message: message },
        { status: 400 }
    )
}

/**
 * Returns standard 500 JSON response
 */
export function serverErrorResponse(error) {
    console.error("Server Error:", error)
    return Response.json(
        { error: "Server error", message: "Something went wrong" },
        { status: 500 }
    )
}
