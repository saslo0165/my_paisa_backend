import assert from 'assert';

const BASE_URL = 'http://localhost:3000/api';

// Globals
let token = '';
let userId = '';
let token2 = '';
let userId2 = '';
let bankId = '';

// Helper to print test headers
function logTest(name) {
    console.log(`\n⏳ Running: ${name}...`);
}

function logSuccess(name) {
    console.log(`✅ Passed: ${name}`);
}

async function request(endpoint, method = 'GET', body = null, authToken = token, headers = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };
    if (authToken) {
        defaultHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    // Convert BigInts before sending (though body shouldn't have raw bigints)
    const options = {
        method,
        headers: { ...defaultHeaders, ...headers },
    };
    if (body) {
        options.body = JSON.stringify(body, (key, value) => typeof value === 'bigint' ? value.toString() : value);
    }

    const res = await fetch(`${BASE_URL}${endpoint}`, options);

    // Some routes might return empty or non-JSON
    let data;
    const text = await res.text();
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        data = text;
    }

    return { status: res.status, data };
}

async function runTests() {
    try {
        console.log("🚀 Starting Savings API Test Suite");

        // --- SETUP ---
        logTest("SETUP - Register User 1");
        const email = `test_${Date.now()}@test.com`;
        const resReg = await request('/auth/register', 'POST', {
            name: "Test User 1",
            email: email,
            phone: `+9199999${Math.floor(Math.random() * 10000)}`,
            password: "password123"
        }, null);
        assert.equal(resReg.status, 201, `Failed to register user: ${JSON.stringify(resReg.data)}`);
        token = resReg.data.accessToken;
        userId = resReg.data.user.id;
        logSuccess("SETUP - Register User 1");

        logTest("SETUP - Add Bank");
        const resBank = await request('/banks', 'POST', {
            bankName: "SBI",
            accountNumber: "1234567890",
            holderName: "Test Name",
            accountType: "Savings",
            initialBalance: 56000 // 56,000 RS = 5,600,000 Paise
        });
        assert.equal(resBank.status, 201);
        bankId = resBank.data.id;
        logSuccess("SETUP - Add Bank");

        logTest("SETUP - Register User 2");
        const email2 = `test2_${Date.now()}@test.com`;
        const resReg2 = await request('/auth/register', 'POST', {
            name: "Test User 2",
            email: email2,
            phone: `+9188888${Math.floor(Math.random() * 10000)}`,
            password: "password123"
        }, null);
        token2 = resReg2.data.accessToken;
        userId2 = resReg2.data.user.id;
        logSuccess("SETUP - Register User 2");


        // --- TEST GROUP 1 ---
        logTest("T01 - Select bank");
        let res = await request(`/users/${userId}/banks/select`, 'POST', { bankId });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.currentBank.id, bankId);
        logSuccess("T01");

        logTest("T02 - Get current bank (No savings yet)");
        res = await request(`/users/${userId}/banks/current`, 'GET');
        assert.equal(res.status, 200);
        assert.equal(res.data.bank.id, bankId);
        assert.equal(res.data.bank.balancePaise, "5600000"); // Initial balance in paise
        logSuccess("T02");

        logTest("T03 - Select non-existent bank");
        res = await request(`/users/${userId}/banks/select`, 'POST', { bankId: "fake-uuid-1234-abcd" });
        assert.equal(res.status, 404);
        assert.equal(res.data.error, "BANK_NOT_FOUND");
        logSuccess("T03");

        logTest("T04 - Select other user's bank");
        // User 2 trying to select User 1's bank
        res = await request(`/users/${userId2}/banks/select`, 'POST', { bankId }, token2);
        assert.equal(res.status, 404); // Should be exactly 404 per specs
        logSuccess("T04");


        // --- TEST GROUP 2 ---
        logTest("T05 - Save RD ₹13,000");
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 1300000,
            savingType: "rd",
            note: "March RD"
        });
        assert.equal(res.status, 201, `Failed: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.balanceBefore, "5600000");
        assert.equal(res.data.balanceAfter, "4300000"); // 5600000 - 1300000
        assert.equal(res.data.saving.amountPaise, "1300000");
        logSuccess("T05");

        logTest("T06 - Save SIP ₹500");
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 50000, // 500 * 100
            savingType: "sip"
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.balanceAfter, "4250000"); // 4300000 - 50000
        logSuccess("T06");

        logTest("T07 - Save Chit ₹2,000");
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 200000,
            savingType: "chit"
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.balanceAfter, "4050000"); // 4250000 - 200000
        logSuccess("T07");

        logTest("T08 - Save EF ₹5,000");
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 500000,
            savingType: "ef"
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.balanceAfter, "3550000"); // 4050000 - 500000
        logSuccess("T08");

        logTest("T09 - Get current month");
        res = await request(`/users/${userId}/savings/current-month`, 'GET');
        assert.equal(res.status, 200);
        assert.equal(res.data.totalPaise, "2050000"); // 1300000 + 50000 + 200000 + 500000
        assert.equal(res.data.totalFormatted, "₹20,500.00");
        assert.equal(res.data.savingCount, 4);
        assert.equal(res.data.breakdown.rd.isPaid, true);
        assert.equal(res.data.breakdown.custom.isPaid, false);
        logSuccess("T09");


        // --- TEST GROUP 3 ---
        logTest("T10 - Try to save more than balance");
        // Balance is 3550000. Try 4000000.
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 4000000,
            savingType: "custom"
        });
        assert.equal(res.status, 400);
        assert.equal(res.data.error, "INSUFFICIENT_BALANCE");
        assert.equal(res.data.details.shortfallFormatted, "₹4,500.00");
        logSuccess("T10");

        logTest("T11 - Save exactly remaining balance");
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 3550000,
            savingType: "custom"
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.balanceAfter, "0");
        logSuccess("T11");


        // --- TEST GROUP 4 ---
        logTest("T12 - Missing amountPaise");
        res = await request(`/users/${userId}/savings`, 'POST', { savingType: "rd" });
        assert.equal(res.status, 422);
        logSuccess("T12");

        logTest("T13 - amountPaise = 0");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 0, savingType: "rd" });
        assert.equal(res.status, 422);
        logSuccess("T13");

        logTest("T14 - amountPaise = -500");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: -500, savingType: "rd" });
        assert.equal(res.status, 422);
        logSuccess("T14");

        logTest("T15 - amountPaise = 13000.50");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 13000.50, savingType: "rd" });
        assert.equal(res.status, 422);
        logSuccess("T15");

        logTest("T16 - Invalid savingType");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "stocks" });
        assert.equal(res.status, 422);
        logSuccess("T16");

        logTest("T17 - Invalid month format");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "rd", month: "March 2026" });
        assert.equal(res.status, 422);
        logSuccess("T17");

        logTest("T18 - Future month");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "rd", month: "2099-01" });
        assert.equal(res.status, 422);
        logSuccess("T18");

        logTest("T19 - Past month without override");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "sip", month: "2020-01" });
        assert.equal(res.status, 422);
        logSuccess("T19");

        logTest("T20 - Past month with override no reason");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "sip", month: "2020-01", isOverride: true });
        assert.equal(res.status, 422);
        logSuccess("T20");

        logTest("T21 - Past month with override and reason");
        // Needs a top up because balance is 0. 
        // We'll just call Prisma directly to top up balance for convenience
        // Wait, T21 doesn't actually say to top up, but amountPaise is 100.
        // Let's create a reverse transaction to add funds!
        // Actually, we can use the DELETE savings endpoint to refund the bank! It's a great test.
        logTest("Helper: Deleting EF saving to refund bank");
        const getSavRes = await request(`/users/${userId}/savings/current-month`, 'GET');
        const customSaving = getSavRes.data.savings.find(s => s.savingType === 'custom');
        if (customSaving) {
            await request(`/savings/${customSaving.id}`, 'DELETE', null, token); // This refunds 3550000
        }
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 100,
            savingType: "sip",
            month: "2020-01",
            isOverride: true,
            overrideReason: "Forgot last month"
        });
        // 2020-01 sip saving shouldn't conflict since previous sip was for current month
        assert.equal(res.status, 201);
        assert.equal(res.data.saving.isOverride, true);
        logSuccess("T21");


        // --- TEST GROUP 5 ---
        logTest("T22 - Duplicate savingType same month");
        // Try to save RD again for current month
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 100,
            savingType: "rd"
        });
        assert.equal(res.status, 409);
        assert.equal(res.data.error, "SAVING_EXISTS");
        logSuccess("T22");

        logTest("T23 - Idempotency key duplicate");
        const idemKey = `test-key-${Date.now()}`;
        // Add new type so it doesn't hit the UNIQUE constraint
        res = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 100,
            savingType: "custom",
            month: "2020-01",
            isOverride: true,
            overrideReason: "test idempotency"
        }, token, { 'Idempotency-Key': idemKey });
        assert.equal(res.status, 201);

        // Exact same request again
        const resTwice = await request(`/users/${userId}/savings`, 'POST', {
            amountPaise: 100,
            savingType: "custom",
            month: "2020-01",
            isOverride: true,
            overrideReason: "test idempotency"
        }, token, { 'Idempotency-Key': idemKey });

        assert.equal(resTwice.status, 200, `Expected 200, got ${resTwice.status}`); // Should return 200 NOT 201
        assert.equal(resTwice.data.isDuplicate, true);
        logSuccess("T23");


        // --- TEST GROUP 6 ---
        logTest("T24 - No token");
        res = await request(`/users/${userId}/savings`, 'POST', { amountPaise: 100, savingType: "rd" }, null);
        assert.equal(res.status, 401);
        logSuccess("T24");

        logTest("T25 - Wrong userId in path");
        res = await request(`/users/wrong-id/savings`, 'POST', { amountPaise: 100, savingType: "rd" });
        assert.equal(res.status, 403);
        logSuccess("T25");

        logTest("T26 - Other user's savings");
        res = await request(`/users/${userId}/savings/current-month`, 'GET', null, token2);
        assert.equal(res.status, 403);
        logSuccess("T26");


        // --- TEST GROUP 7 ---
        logTest("T27 - User without bank selected");
        res = await request(`/users/${userId2}/savings`, 'POST', { amountPaise: 100, savingType: "rd" }, token2);
        assert.equal(res.status, 404);
        assert.equal(res.data.error, "NO_CURRENT_BANK");
        logSuccess("T27");

        // --- TEST GROUP 8 (Concurrency Proxy) ---
        logTest("T28 - Concurrency Test Proxy");
        // We simulate sending 2 identical valid requests simultaneously to see if DB lock catches it
        // Or if unique constraint catches it. 
        // We'll use a new idempotency key just in case, but different savingTypes to test balance lock
        // Let's add bank to user 2, give 5000 funds.
        const resBank2 = await request('/banks', 'POST', {
            bankName: "HDFC",
            accountNumber: "9876543210",
            holderName: "Test 2",
            accountType: "Current",
            initialBalance: 50 // 50 RS = 5000 paise
        }, token2);
        const bankId2 = resBank2.data.id;
        await request(`/users/${userId2}/banks/select`, 'POST', { bankId: bankId2 }, token2);

        // Send two requests of 3000 paise each at the same microsecond
        const req1 = request(`/users/${userId2}/savings`, 'POST', {
            amountPaise: 3000,
            savingType: "rd"
        }, token2);

        const req2 = request(`/users/${userId2}/savings`, 'POST', {
            amountPaise: 3000,
            savingType: "sip"
        }, token2);

        const [r1, r2] = await Promise.all([req1, req2]);

        // One should succeed (201), one should fail (400) due to balance!
        const statuses = [r1.status, r2.status].sort();
        // It's possible the second returns 400 Insufficient Balance
        assert.equal(statuses[0], 201, `Expected one 201, got ${statuses}`);
        assert.equal(statuses[1], 400, `Expected one 400, got ${statuses}`);
        logSuccess("T28");

        console.log("\n✅ ALL 28 TESTS COMPLETED SUCCESSFULLY.");

    } catch (e) {
        console.error("\n❌ TEST FAILED:", e);
        process.exit(1);
    }
}

runTests();
