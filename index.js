import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import * as borsh from 'borsh';
import { assert } from 'console';

// Constants for generating PDAs
const GAME_CONFIG_SEED = Buffer.from("GAME_CONFIG");
const USER_SEED = Buffer.from("USER");

const connection = new Connection("http://localhost:8899", "confirmed");

// The PROGRAM_ID should be changed after deploying locally.
const PROGRAM_ID = new PublicKey("PROGRAM_ID_GOES_HERE");

class User {
    constructor(fields) {
        this.accountType = fields.accountType;
        this.authority = fields.authority;
        this.gameConfig = fields.gameConfig;
        this.credits = fields.credits;
        this.level = fields.level;
    }
}

class GameConfig {
    constructor(fields) {
        this.account_type = fields.account_type;
        this.credits_per_level = fields.credits_per_level;
    }
}

const UserSchema = new Map([
    [
        User,
        {
            kind: 'struct',
            fields: [
                ['accountType', 'u8'],
                ['authority', [32]],
                ['gameConfig', [32]],
                ['credits', 'u32'],
                ['level', 'u8'],
            ],
        },
    ],
]);

const GameConfigSchema = new Map([
    [
        GameConfig,
        {
            kind: 'struct',
            fields: [
                ['account_type', 'u8'],
                ['credits_per_level', 'u8'],
            ],
        },
    ],
]);

async function checkUserCredits(connection, userPDA, anchor = false) {
    const accountInfo = await connection.getAccountInfo(userPDA);
    if (!accountInfo) {
        throw new Error('User account not found');
    }
    let userAccount;

    if (anchor) {
        const data = accountInfo.data.slice(8);
        userAccount = borsh.deserializeUnchecked(UserSchema, User, data);
    } else {
        userAccount = borsh.deserializeUnchecked(UserSchema, User, accountInfo.data);
    }

    return userAccount;
}

async function checkGameConfig(connection, gameConfigPDA, anchor = false) {
    const accountInfo = await connection.getAccountInfo(gameConfigPDA);
    if (!accountInfo) {
        throw new Error("Game config account not found");
    }

    let gameConfig;
    if (anchor) {
        const data = accountInfo.data.slice(8);
        gameConfig = borsh.deserializeUnchecked(GameConfigSchema, GameConfig, data);
    } else {
        gameConfig = borsh.deserializeUnchecked(GameConfigSchema, GameConfig, accountInfo.data);
    }

    return gameConfig;
}

/**
 * Helper functions to encode instruction data
 * 
 * Enum variants are assumed to be:
 *        0: CreateGameConfig 
 *        1: CreateUser 
 *        2: MintCreditsToUser 
 *        3: UserLevelUp
 */
function encodeCreateGameConfig(creditsPerLevel) {
    // 1 byte for variant, 1 byte for credits_per_level
    const buf = Buffer.alloc(2);
    buf.writeUInt8(0, 0); // variant 0
    buf.writeUInt8(creditsPerLevel, 1);
    return buf;
}

function encodeCreateUser() {
    // Only the variant (1) since there are no fields.
    return Buffer.from([1]);
}

function encodeMintCreditsToUser(credits) {
    // 1 byte for variant, 4 bytes for u32 credits in little-endian
    const buf = Buffer.alloc(5);
    buf.writeUInt8(2, 0); // variant 2
    buf.writeUInt32LE(credits, 1);
    return buf;
}

function encodeUserLevelUp(creditsToBurn) {
    // 1 byte for variant, 4 bytes for u32 credits_to_burn in little-endian
    const buf = Buffer.alloc(5);
    buf.writeUInt8(3, 0); // variant 3
    buf.writeUInt32LE(creditsToBurn, 1);
    return buf;
}

const delay = (delayInms) => {
    return new Promise(resolve => setTimeout(resolve, delayInms));
};

// ----- Test: Level Up without Minting Credits -----
async function testLevelUpWithoutMinting() {
    console.log("=== Running Test: Level Up without Minting Credits ===");
    const admin = Keypair.generate();
    const userAuthority = Keypair.generate();

    // Airdrop SOL to cover fees
    let airdropSig = await connection.requestAirdrop(admin.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    airdropSig = await connection.requestAirdrop(userAuthority.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    await delay(2000);

    // --- 1. Create Game Config ---
    // Derive the game_config PDA using [admin, GAME_CONFIG_SEED]
    const [gameConfigPDA] = PublicKey.findProgramAddressSync(
        [admin.publicKey.toBuffer(), GAME_CONFIG_SEED],
        PROGRAM_ID
    );
    const createGameConfigIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateGameConfig(10) // credits_per_level = 10
    });
    let tx = new Transaction().add(createGameConfigIx);
    await sendAndConfirmTransaction(connection, tx, [admin]);
    await delay(2000);
    console.log("Game config created at", gameConfigPDA.toBase58());

    // --- 2. Create User ---
    // Derive the user PDA using [gameConfigPDA, userAuthority, USER_SEED]
    const [userPDA] = PublicKey.findProgramAddressSync(
        [gameConfigPDA.toBuffer(), userAuthority.publicKey.toBuffer(), USER_SEED],
        PROGRAM_ID
    );
    const createUserIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateUser()
    });
    tx = new Transaction().add(createUserIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("User PDA created at", userPDA.toBase58());
    let user = await checkUserCredits(connection, userPDA);
    console.log("User credits Before: ", user.credits)
    console.log("User level Before: ", user.level)

    // --- 3. SKIP: Minting Credits ---
    //  Purposely do not mint any credits so that the user's balance remains 0.

    // --- 4. User Level Up ---
    // Attempt to level up with a burn value of 70.
    // With 0 credits, subtracting the calculated cost (e.g., 60) will underflow.
    const levelUpIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeUserLevelUp(70)
    });
    tx = new Transaction().add(levelUpIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("User level up attempted with burn of 70 WITHOUT minting credits");
    user = await checkUserCredits(connection, userPDA);
    console.log("User credits After: ", user.credits)
    console.log("User level After: ", user.level)
}

// ----- Test:  Underflow Leads to Excessive User Credit Mint -----
async function testUnderflowIssue() {
    console.log("=== Running Underflow Issue Test ===");
    const admin = Keypair.generate();
    const userAuthority = Keypair.generate();

    // Airdrop SOL to cover fees
    let airdropSig = await connection.requestAirdrop(admin.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    airdropSig = await connection.requestAirdrop(userAuthority.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    await delay(2000);

    // Create Game Config
    const [gameConfigPDA] = PublicKey.findProgramAddressSync(
        [admin.publicKey.toBuffer(), GAME_CONFIG_SEED],
        PROGRAM_ID
    );
    const createGameConfigIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateGameConfig(10)
    });
    let tx = new Transaction().add(createGameConfigIx);
    await sendAndConfirmTransaction(connection, tx, [admin]);
    await delay(2000);
    console.log("Game config created at", gameConfigPDA.toBase58());
    let game = await checkGameConfig(connection, gameConfigPDA);
    console.log("Initialized Game Level: ", game.credits_per_level);
    console.log("Initialized Game AccountType: ", game.account_type);

    // Create User
    const [userPDA] = PublicKey.findProgramAddressSync(
        [gameConfigPDA.toBuffer(), userAuthority.publicKey.toBuffer(), USER_SEED],
        PROGRAM_ID
    );
    const createUserIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateUser()
    });
    tx = new Transaction().add(createUserIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("User PDA created at", userPDA.toBase58());
    await checkUserCredits(connection, userPDA);

    // GameConfig Admin Mint 50 credits to User
    const CREDITS_TO_MINT = 50;
    const mintCreditsIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeMintCreditsToUser(CREDITS_TO_MINT)
    });
    tx = new Transaction().add(mintCreditsIx);
    await sendAndConfirmTransaction(connection, tx, [admin]);
    await delay(2000);
    console.log("GameConfig Admin Minted 50 credits to user");
    let userCredits = await checkUserCredits(connection, userPDA);
    console.log("User Credits: ", userCredits.credits)
    console.log("User Level: ", userCredits.level)

    const CREDITS_TO_BURN = 70; // Assumption is that can be a mistake from user's end.
    const levelUpIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeUserLevelUp(CREDITS_TO_BURN)
    });
    tx = new Transaction().add(levelUpIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);

    console.log("User level up attempted with burn of 70");
    userCredits = await checkUserCredits(connection, userPDA);
    console.log("User Credits: ", userCredits.credits)
    console.log("User Level: ", userCredits.level)
    assert(Number(userCredits.credits) == Math.pow(2, 32) - 10)
}

// ----- Test: Max-Level Deduction -----
async function testMaxLevelDeductionIssue() {
    console.log("=== Running Max-Level Deduction Issue Test ===");
    // const connection = new Connection("http://localhost:8899", "confirmed");
    const admin = Keypair.generate();
    const userAuthority = Keypair.generate();

    // Airdrop SOL
    let airdropSig = await connection.requestAirdrop(admin.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    airdropSig = await connection.requestAirdrop(userAuthority.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    await delay(2000);

    // Create Game Config
    const [gameConfigPDA] = PublicKey.findProgramAddressSync(
        [admin.publicKey.toBuffer(), GAME_CONFIG_SEED],
        PROGRAM_ID
    );
    const createGameConfigIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateGameConfig(10)
    });
    let tx = new Transaction().add(createGameConfigIx);
    await sendAndConfirmTransaction(connection, tx, [admin]);
    await delay(2000);
    console.log("Game config created at", gameConfigPDA.toBase58());

    // Create User
    const [userPDA] = PublicKey.findProgramAddressSync(
        [gameConfigPDA.toBuffer(), userAuthority.publicKey.toBuffer(), USER_SEED],
        PROGRAM_ID
    );
    const createUserIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateUser()
    });
    tx = new Transaction().add(createUserIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("User PDA created at", userPDA.toBase58());
    await checkUserCredits(connection, userPDA);

    // Mint a huge amount of credits so the user can level up to max.
    const hugeCreditAmount = 1_000_000;
    const mintHugeCreditsIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeMintCreditsToUser(hugeCreditAmount)
    });
    tx = new Transaction().add(mintHugeCreditsIx);
    await sendAndConfirmTransaction(connection, tx, [admin]);
    await delay(2000);
    console.log("Minted huge credits to user to enable max level");
    let userCredits = await checkUserCredits(connection, userPDA);
    console.log("User Credits: ", userCredits.credits)
    console.log("User Level: ", userCredits.level)

    // Level up with a burn value high enough to push the level to max.
    const burnValueForMax = 1_000_000;
    const maxLevelUpIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeUserLevelUp(burnValueForMax)
    });
    tx = new Transaction().add(maxLevelUpIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    let creditsBefore = await checkUserCredits(connection, userPDA);
    console.log("Credits before extra level up at max:", creditsBefore.credits);
    console.log("User Level: ", creditsBefore.level)

    // Now, call level up again with a small burn value even though the level is maxed.
    const extraBurnValue = 1000;
    const extraLevelUpIx = new TransactionInstruction({
        keys: [
            { pubkey: gameConfigPDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeUserLevelUp(extraBurnValue)
    });
    tx = new Transaction().add(extraLevelUpIx);
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    let credeitsAfter = await checkUserCredits(connection, userPDA);
    console.log("Credits after extra level up at max:", credeitsAfter.credits);
    console.log("User Level after level up: ", credeitsAfter.level)
    assert(Number(credeitsAfter.credits) < Number(creditsBefore.credits), "Credits did not decrease!");
    assert(Number(creditsBefore.level) == Number(credeitsAfter.level), "Level did not increase.");

}

// ----- Test:  Missing Verification of Game Config Linkage in LevelUp -----
async function MissingVerificationofGameConfigInLevelUp() {
    console.log("=== Running Issue #4 Test: Missing Verification of Game Config Linkage in LevelUp ===");

    // Create two admin keypairs for two different configurations.
    const admin1 = Keypair.generate();
    const admin2 = Keypair.generate();
    // Create a user authority keypair.
    const userAuthority = Keypair.generate();

    // Airdrop SOL for fees.
    let sig = await connection.requestAirdrop(admin1.publicKey, 2e9);
    await connection.confirmTransaction(sig);
    sig = await connection.requestAirdrop(admin2.publicKey, 2e9);
    await connection.confirmTransaction(sig);
    sig = await connection.requestAirdrop(userAuthority.publicKey, 2e9);
    await connection.confirmTransaction(sig);
    await delay(2000);

    // --- Step 1: Create Config1 using admin1 (credits_per_level = 10) ---
    const [config1PDA] = PublicKey.findProgramAddressSync(
        [admin1.publicKey.toBuffer(), GAME_CONFIG_SEED],
        PROGRAM_ID
    );
    let tx = new Transaction().add(new TransactionInstruction({
        keys: [
            { pubkey: config1PDA, isSigner: false, isWritable: true },
            { pubkey: admin1.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateGameConfig(10)
    }));
    await sendAndConfirmTransaction(connection, tx, [admin1]);
    await delay(2000);
    console.log("Config1 created at:", config1PDA.toBase58());
    let game = await checkGameConfig(connection, config1PDA);
    console.log("Initialized config1PDA Level: ", game.credits_per_level);
    console.log("Initialized config1PDA AccountType: ", game.account_type);

    // --- Step 2: Create User using Config1 ---
    const [userPDA] = PublicKey.findProgramAddressSync(
        [config1PDA.toBuffer(), userAuthority.publicKey.toBuffer(), USER_SEED],
        PROGRAM_ID
    );
    tx = new Transaction().add(new TransactionInstruction({
        keys: [
            { pubkey: config1PDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateUser()
    }));
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("User created at:", userPDA.toBase58());

    // --- Step 3: Create Config2 using admin2 (credits_per_level = 1) ---
    const [config2PDA] = PublicKey.findProgramAddressSync(
        [admin2.publicKey.toBuffer(), GAME_CONFIG_SEED],
        PROGRAM_ID
    );
    tx = new Transaction().add(new TransactionInstruction({
        keys: [
            { pubkey: config2PDA, isSigner: false, isWritable: true },
            { pubkey: admin2.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeCreateGameConfig(1)  // Config2 has credits_per_level = 1
    }));
    await sendAndConfirmTransaction(connection, tx, [admin2]);
    await delay(2000);
    console.log("Config2 created at:", config2PDA.toBase58());
    game = await checkGameConfig(connection, config2PDA);
    console.log("Initialized config2PDA Level: ", game.credits_per_level);
    console.log("Initialized config2PDA AccountType: ", game.account_type);

    // --- Step 4: Mint 50 credits to User using Config1 ---
    tx = new Transaction().add(new TransactionInstruction({
        keys: [
            { pubkey: config1PDA, isSigner: false, isWritable: false },
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: admin1.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeMintCreditsToUser(50)
    }));
    await sendAndConfirmTransaction(connection, tx, [admin1]);
    await delay(2000);
    console.log("Minted 50 credits to user using Config1");

    // --- Step 5: Call LevelUp using Config2 instead of Config1 ---
    // Using a burn value of 30.
    tx = new Transaction().add(new TransactionInstruction({
        keys: [
            { pubkey: config2PDA, isSigner: false, isWritable: false }, // Wrong config provided!
            { pubkey: userPDA, isSigner: false, isWritable: true },
            { pubkey: userAuthority.publicKey, isSigner: true, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: encodeUserLevelUp(30)
    }));
    await sendAndConfirmTransaction(connection, tx, [userAuthority]);
    await delay(2000);
    console.log("Called level up with burn 30 using Config2");

    // --- Step 6: Verify User Account State ---
    const userAccount = await checkUserCredits(connection, userPDA);
    console.log("User account after level up:", userAccount.level);
    // Expected: The level-up calculation uses config2's credits_per_level (1) instead of config1's (10),
    // causing an unexpected outcome. For example, if using config1 would result in level 2 and 40 credits,
    // the use of config2 will alter that calculation.
    // Simply assert that the level is not what would be expected if the proper config were used.
    assert(Number(userAccount.level) != 2, "User level should not be 2 if wrong config is used");
}

const tests = {
    testUnderflowIssue,
    testLevelUpWithoutMinting,
    testMaxLevelDeductionIssue,
    MissingVerificationofGameConfigInLevelUp
};

async function main() {
    const testName = process.argv[2];
    try {
        if (!testName || testName === "all") {
            // Run all tests sequentially.
            for (const [name, testFunc] of Object.entries(tests)) {
                await testFunc();
                console.log(`${name} - Test completed.\n`);
                await delay(3000);
            }
        } else if (tests[testName]) {
            await tests[testName]();
            console.log(`${testName} - Test completed.\n`);
        } else {
            console.error(
                "No valid test specified. Use one of: " +
                Object.keys(tests).join(", ") +
                " or 'all'."
            );
            process.exit(1);
        }
    } catch (err) {
        console.error("Test failed", err);
        process.exit(1);
    }
}

main();