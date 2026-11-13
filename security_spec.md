# Security Specification: Crypto Pi Token

## 1. Data Invariants
1. **PII Isolation**: User email addresses reside exclusively in `users/{userId}` and are never readable or listable by any other user. `leaderboard/{userId}` contains zero PII.
2. **Identity Integrity**: A user may only create or mutate their own `users/{userId}`, `users/{userId}/quiz_attempts/{dateId}`, and `leaderboard/{userId}` documents where `uid == request.auth.uid` and `request.auth.token.email_verified == true`.
3. **Immutable Audit & Terminal Locking**: `createdAt` and `uid` are immutable after creation. `users/{userId}/quiz_attempts/{dateId}` cannot be updated or deleted once created (`status == 'completed'`), guaranteeing once-per-day quiz reward enforcement.
4. **Atomic Quiz Reward**: Updating `lastQuizDate` on `leaderboard/{userId}` requires an atomic batch write that simultaneously creates `users/{userId}/quiz_attempts/{lastQuizDate}` (`existsAfter`).
5. **Temporal Integrity**: `createdAt`, `updatedAt`, and `lastCollectAt` (on create or collect) must equal `request.time`.
6. **Boundary & Volumetric Limits**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), all strings enforce explicit `size()` bounds, numeric balances/totals cannot go negative, and upgrade levels remain within `[0..1000]`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Creating `leaderboard/attacker` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Creating `users/uid1` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Identity Spoofing**: User A (`uidA`) attempting to create `leaderboard/uidA` with `uid: "uidB"` -> `PERMISSION_DENIED`.
4. **Cross-User Mutation**: User A (`uidA`) updating `leaderboard/uidB` -> `PERMISSION_DENIED`.
5. **PII Blanket List / Read**: User A (`uidA`) reading `users/uidB` or listing `users` -> `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: Creating/updating `leaderboard/uidA` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **Resource Poisoning (Oversized ID)**: Accessing `leaderboard/${'a'.repeat(300)}` -> `PERMISSION_DENIED`.
8. **Resource Poisoning (Oversized String)**: Setting `piHandle` to 200-char string -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a past/future client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Terminal State Replay (Quiz Double-Claim)**: Updating or recreating `users/uidA/quiz_attempts/2026-11-13` -> `PERMISSION_DENIED`.
11. **Orphaned Quiz Date Spoof**: Updating `lastQuizDate` on `leaderboard/uidA` without creating the matching `quiz_attempts/{dateId}` document in the same batch -> `PERMISSION_DENIED`.
12. **Negative Balance / Upgrade Downgrade**: Updating `leaderboard/uidA` with `balance: -500` or decreasing `tapLevel` -> `PERMISSION_DENIED`.
