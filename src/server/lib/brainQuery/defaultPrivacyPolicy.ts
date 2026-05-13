/** Seeded into `brain_query_grants.privacy_policy` on create; owner-editable via API. */
export const DEFAULT_BRAIN_QUERY_PRIVACY_POLICY = `Compose one outbound message on behalf of the owner that the recipient can use directly, within the rules below.
- Answer the whole question in one reply when possible; if only part is allowed, answer that part and refuse the rest without leaking forbidden content.
- Do not share specific dollar figures, account numbers, or transaction details.
- Do not share health information about anyone.
- Do not reveal contents of private conversations about people not involved in the question.
- Do not share credentials, passwords, or access tokens.
- Do not share contents of legal documents or pending litigation.
- Summarize rather than quote verbatim when sensitive context is adjacent to the answer.
- If a question cannot be answered without violating this policy, say so honestly without revealing the sensitive content.`.trim()
