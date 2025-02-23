## Instructions on running POCs
```js
// Step 0: Clone the repo & cd into the directory.
git clone https://github.com/HalbornSecurity/CTFs.git
cd /HalbornCTF_Rust_Solana/ctf_game/ctf

// Step 1: To build the ctf repo
cargo build-sbf

// Step 2: Run the Solana Test Validator 
solana-test-validator

// Step 3: To deploy the program locally, this will output the ProgramID
solana program deploy ./target/deploy/solana_vulnerable_game.so

// Step 4: REPLACE the ProgramID after deployment in 'index.js' PROGRAM_ID variable 
const PROGRAM_ID = new PublicKey("PROGRAM_ID_GOES_HERE");

// Step 5: Install npm dependencies (Recommended Node version = v22.12.0)
npm install

// Step 6: Run specific or all POCs
node index.js all

/**
 * Step 7 (Optional): Run a specific POC, options include:
 * - testUnderflowIssue
 * - testLevelUpWithoutMinting
 * - testMaxLevelDeductionIssue
 * - MissingVerificationofGameConfigInLevelUp
 * - all
*/
node index.js testUnderflowIssue
```