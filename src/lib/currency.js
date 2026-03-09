/**
 * src/lib/currency.js
 * 
 * Utility functions for handling currency conversions safely
 * using BigInt (paise) to avoid floating-point errors.
 */

/**
 * Convert Rupees (e.g. 56000.50) to Paise (BigInt 5600050n)
 * @param {number} rupees 
 * @returns {bigint}
 */
export function toPaise(rupees) {
    if (rupees === undefined || rupees === null) return 0n;
    // Multiply by 100 and round to avoid floating point precision issues during conversion
    return BigInt(Math.round(rupees * 100));
}

/**
 * Convert Paise (BigInt 5600050n) to Rupees (56000.50)
 * @param {bigint} paise 
 * @returns {number}
 */
export function toRupees(paise) {
    if (paise === undefined || paise === null) return 0;
    // Convert BigInt to Number safely and divide by 100
    return Number(paise) / 100;
}

/**
 * Standardize JSON response by converting BigInt to Number
 * JavaScript's default JSON.stringify crashes on BigInt.
 * This helper walks through objects and safely casts BigInts.
 */
export function serializeBigInt(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj); // Assuming values won't exceed MAX_SAFE_INTEGER
    if (Array.isArray(obj)) return obj.map(serializeBigInt);

    // Check if Date to prevent converting to empty object
    if (obj instanceof Date) return obj.toISOString();

    if (typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = serializeBigInt(obj[key]);
        }
        return newObj;
    }

    return obj;
}

/**
 * Wrapper for Response.json that safely serializes BigInts
 */
export function jsonResponse(data, init) {
    const safeData = serializeBigInt(data);
    return Response.json(safeData, init);
}
