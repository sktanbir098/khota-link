# KothaLink Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **No PII Exposure**: Raw `email` and `phoneNumber` values are strictly isolated in `/users/{userId}/private/info` and are only readable/writable by the owning `userId` (`request.auth.uid == userId`).
2. **Zero Directory Enumeration**: `/email_directory`, `/phone_directory`, `/chat_invites`, `/nearby_rooms`, and `/users/{userId}/private` forbid `list` queries (`allow list: if false;`). Only exact document `get` lookups are permitted to verified signed-in users.
3. **Immutable Ownership & Identity**: Every created document checks `uid == request.auth.uid`, `creatorId == request.auth.uid`, `senderId == request.auth.uid`, or `hostUid == request.auth.uid`. `createdAt` is locked to `request.time` on creation and immutable on updates.
4. **Master Gate Enforcement**: Messages inside `/chats/{chatId}/messages/{messageId}` require verifying the parent chat exists and `request.auth.uid in parent.participantIds`. Signals and messages inside `/nearby_rooms/{roomCode}` require verifying the parent room exists and `request.auth.uid == hostUid || request.auth.uid == guestUid`.
5. **Terminal State Locking**: Once a `nearby_rooms/{roomCode}` document transitions to `status == "closed"`, all further updates are rejected.
6. **Strict Payload Boundaries**: Every string, list, and ID is validated for exact type, regex format (`^[a-zA-Z0-9_\-]+$`), and `.size()` bounds. No shadow keys allowed (`hasOnly`).

## 2. Dirty Dozen Adversarial Payloads (All Must Fail with PERMISSION_DENIED)
1. **Unauthenticated Read**: Anonymous client attempts `get /users/userA`.
2. **Unverified Email Write**: Signed-in user with `email_verified == false` attempts `create /chats/chat1`.
3. **PII Leak Attempt**: `userB` attempts `get /users/userA/private/info`.
4. **Directory Scraping**: `userB` attempts `list /phone_directory` or `list /email_directory`.
5. **Identity Spoofing on Profile**: `userB` attempts `create /users/userB` with `uid: "userA"`.
6. **Shadow Field Injection**: `userA` attempts `update /users/userA` with `{ displayName: "Ali", isAdmin: true }`.
7. **ID Poisoning**: `userA` attempts `create /chats/<1500-char-junk-id>`.
8. **Message Forgery**: `userB` (not in `chat1.participantIds`) attempts `create /chats/chat1/messages/m1`.
9. **Sender Impersonation**: `userB` (in `chat1.participantIds`) attempts `create /chats/chat1/messages/m1` with `senderId: "userA"`.
10. **Client Timestamp Tampering**: `userA` sends `createdAt: Timestamp(1999-01-01)` instead of `request.time`.
11. **Terminal State Bypass**: `userA` attempts `update /nearby_rooms/123456` after `status == "closed"`.
12. **Chat List Scraping**: `userB` attempts `list /chats` without filtering `participantIds array-contains userB`.
