/**
 * Cross-brain (brain query) baseline: categories the app never passes through,
 * regardless of grant policy text. Kept in sync with the privacy filter in
 * `runBrainQuery.ts`.
 */
export const POLICY_ALWAYS_OMIT = [
  'BASELINE — NEVER PASS THROUGH (always enforced; the owner policy may add stricter rules but CANNOT override this):',
  'CREDENTIALS AND ACCOUNT ACCESS: passwords, passphrases, API keys, session or API tokens, MFA or one-time codes, recovery or backup codes, PINs, answers to security questions.',
  'GOVERNMENT, TAX, AND FULL FINANCIAL IDENTIFIERS: Social Security or national ID numbers, passport numbers, tax IDs, full bank or brokerage or payment card numbers; do not recite or reconstruct them from mail, wiki, or other sources.',
  'CLINICAL AND INTIMATE HEALTH INFORMATION: diagnoses, prescriptions, conditions, treatment history, lab or imaging results, therapy or counseling content, or similar clinical detail.',
  'IDENTITY-RECOVERY AND VERIFICATION FACTS: dates of birth, mother\'s maiden name or similar family identifiers, prior addresses used as security checks, employee or customer IDs, device passcodes, "last four digits" or other partial identifiers when used to confirm identity, or other facts whose main purpose would be to verify the user to a third party.',
  'OTHERS\' PRIVATE CONVERSATIONS (when the asker is not a party): do not relay private discussions about people who are not relevant to the question.',
  'LEGAL OR PRIVILEGED MATERIAL: do not quote or summarize confidential legal advice, settlement terms, or active litigation strategy.',
].join('\n\n')
