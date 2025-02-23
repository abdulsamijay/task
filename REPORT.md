## Summary of Findings
The repository under review was located at https://github.com/HalbornSecurity/CTFs/tree/master/HalbornCTF_Rust_Solana with commit Hash of `684f1af02132d4cfa4c6ac04924d8c8391a6e9cf`. Instructions on running the POCs in this repo can be found [here](./INSTALL.md).
| S.No | Finding Name                                           | Severity |
| ---- | ------------------------------------------------------ | -------- |
| 1    | Underflow Leads to Excessive User Credit Mint          | Critical |
| 2    | Missing Verification of Game Config Linkage in LevelUp | Critical |
| 3    | Extra Credit Deduction at Max-Level                    | High     |
| 4    | Missing asserstions accross                            | Info     |

<hr/>

### Issue #1 - [Critical] Underflow Leads to Excessive User Credit Mint

**Description**
When a user tries to level up by burning more credits than they actually have, the subtraction causes an unsigned integer underflow. Instead of failing gracefully with an "insufficient funds" error, the arithmetic wraps around, causing the user's credit balance to become an extremely large number. This effectively “mints” credits rather than preventing the level-up. There are two scenarios where this can be exploited.
1. **Bypassing GameConfig Admin for Normal Credit Minting**
   A user with zero credits (who has simply executed `create_user` which will default his credits to be `0`) can call `user_level_up` directly, passing a large `credits_to_burn`. Because the user’s credits are insufficient, the subtraction underflows, wrapping around to a huge balance. This will essentially make the `mint_credits_to_user` function to have no significance in the system.
2. **Accidental or Unintended overflow while burning credits**
   Even if a user has been legitimately minted some credits, attempting to burn more than they hold causes the same underflow. Their balance becomes an extremely large integer, breaking the game economy by granting unearned credits.

**Proof-of-Concept (POC)**

The POC for both of the exploitable scenarios can be verified by running the following command in the current directory.
```js
// To run the 1st Scenario
node index.js testLevelUpWithoutMinting
// To run the 2nd Scenario
node index.js testUnderflowIssue
```

**Recommendation**
1. Before subtracting, ensure `user.credits >= level_credits;`. If not, return an error (e.g., “Insufficient Funds”).
2. Use Rust’s std library for checked arithemetics. The link can be found here. [https://doc.rust-lang.org/std/primitive.u32.html].

<hr/>

### Issue #2 - [Critical] Missing Verification of Game Config Linkage in LevelUp
**Description**
The `user_level_up` function checks that the provided accounts are of the correct type (i.e., the game config is of type `GameConfig` and the user is of type `User`), but it fails to verify that the game configuration account supplied during level-up matches the one originally associated with the user account. This allows an attacker to inject different game configuration during the level-up process.

**Proof-of-Concept (POC)**

The POC for both of the exploitable scenarios can be verified by running the following command in the current directory.
```json
node index.js MissingVerificationofGameConfigInLevelUp
```

**Recommendation**
Verifying that the game configuration account passed in matches the one stored in the user account.
```rs
pub fn user_level_up(
    credits_to_burn: u32,
    accounts: &[AccountInfo]
) -> ProgramResult {
    
    //  - Snip -
    
    if user.game_config != *game_config_info.key {
        return Err(ProgramError::InvalidAccountData);
    }
}
```
<hr/>

### Issue #3 - [High] Extra Credit Deduction at Max-Level Credit Mint
**Description**
When a user has reached the maximum allowable level, calling the `user_level_up` function still deducts credits—even though no further level up is possible without checking if the user is at maximum level. Since credits are obtained by the admin of the GameConfig, this results in unnecessary and unintended loss of credits. 

**Proof-of-Concept (POC)**

The POC for both of the exploitable scenarios can be verified by running the following command in the current directory.
```json
node index.js testMaxLevelDeductionIssue
```

**Recommendation**
Add a check for the maximum level before deducting credits
```rs
pub fn user_level_up(
    credits_to_burn: u32,
    accounts: &[AccountInfo]
) -> ProgramResult {
    
    //  - Snip -
    
   if user.level >= MAX_LEVEL {
    // Return a custom error for max level reached (replace 0 with your specific error code).
    return Err(ProgramError::Custom(0));
    }
}
```