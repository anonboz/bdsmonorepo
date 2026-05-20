# Spec: Ticket chat thread (phase 3.2)

> Status: **draft**
> Phase: 3
> Owner: claude
> Spec last updated: 2026-05-18

## 1. Why

Tickets shipped in phase 3.1 with a state machine but no way for the tenant and
owner to actually talk. In practice "Leaky faucet" needs a clarifying question
("which tap?", "is it dripping or pooling?", "when is the plumber arriving?")
before either party can move the ticket forward. Without a thread, this falls
back to texting outside the platform — which breaks the audit trail and means
the ticket loses context the moment someone deletes the message.

This slice adds a simple, append-only chat per ticket so the back-and-forth
lives on the ticket itself.

## 2. User stories

- As a **tenant**, I want to ask a clarifying question on my own ticket so the
  owner can answer in context.
- As an **owner**, I want to reply on the ticket I'm working so the tenant
  sees status updates without me texting them.
- As either party, I want the conversation pinned to the ticket so I can
  re-read it later without scrolling through chat history.
- As an **admin**, I want to read the full thread on any ticket when
  arbitrating a dispute.

## 3. Screens / surfaces

| Surface                     | App    | Route                                                                        | Notes                                    |
| --------------------------- | ------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| Tenant ticket detail thread | tenant | `/my-tickets/[id]`                                                           | Replace the "phase 3.2" placeholder card |
| Owner ticket detail thread  | owner  | `/tickets/[id]`                                                              | Replace the "phase 3.2" placeholder card |
| API list                    | api    | `GET /v1/me/tickets/:id/messages`, `GET /v1/me/owner-tickets/:id/messages`   |                                          |
| API post                    | api    | `POST /v1/me/tickets/:id/messages`, `POST /v1/me/owner-tickets/:id/messages` |                                          |
| API admin read              | api    | `GET /v1/admin/tickets/:id/messages`                                         |                                          |

## 4. API shape

```ts
// @repo/shared/schemas/ticket-messages.ts
export const ticketMessageSchema = z.object({
  id: idSchema,
  ticketId: idSchema,
  authorId: idSchema,
  authorName: z.string(),
  /** Which side the author was on at write time. Frozen for display. */
  authorRole: z.enum(['TENANT', 'OWNER', 'ADMIN']),
  body: z.string().min(1).max(4000),
  createdAt: isoDateTimeSchema,
});

export const createTicketMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const listTicketMessagesQuerySchema = paginationQuerySchema;
```

Endpoints:

| Method | Path                                | Role(s) | Description                    |
| ------ | ----------------------------------- | ------- | ------------------------------ |
| GET    | `/v1/me/tickets/:id/messages`       | TENANT  | Paged, oldest first            |
| POST   | `/v1/me/tickets/:id/messages`       | TENANT  | Append; 404 if not reporter    |
| GET    | `/v1/me/owner-tickets/:id/messages` | OWNER   | Paged, oldest first            |
| POST   | `/v1/me/owner-tickets/:id/messages` | OWNER   | Append; 404 if not lease owner |
| GET    | `/v1/admin/tickets/:id/messages`    | ADMIN   | Read-only                      |

## 5. Data model changes

```prisma
model TicketMessage {
  id       String   @id @default(cuid())
  ticketId String
  ticket   Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  authorId String
  author   User     @relation("TicketMessageAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  /** Frozen role at write time. Avoids confusion if the user gains/loses roles later. */
  authorRole Role
  body     String   @db.VarChar(4000)

  createdAt DateTime @default(now())

  @@index([ticketId, createdAt])
  @@index([authorId])
}
```

Plus on `Ticket`: `messages TicketMessage[]`.
Plus on `User`: `ticketMessages TicketMessage[] @relation("TicketMessageAuthor")`.

Migration name: `ticket_messages`

## 6. Workers / jobs

None this slice. Notifications on new messages are deferred to phase 3.5 — they
need the notifications module which we haven't built yet.

## 7. Permissions

- **TENANT** can read + post on tickets where `ticket.reporterId === user.id`.
- **OWNER** can read + post on tickets where `ticket.lease.ownerId === user.id`.
- **ADMIN** can read any thread. **No posting** — admins arbitrate by writing
  an audit-log entry, not by joining the conversation.
- Cross-party access (tenant trying to read someone else's ticket's thread)
  returns 404 to hide existence.
- Posting to a deleted ticket returns 404.
- Posting to a `CLOSED` ticket older than the 7-day reopen window returns 409
  (`TICKET_THREAD_LOCKED`). Within the window, posting is allowed — keeps the
  reopen UX coherent.

## 8. Edge cases

- Author display name can change after a message is written; we still show the
  current name (joined on read) — same as the parent ticket's `reporterName`.
- Author role at write time is frozen on the row so a tenant who later becomes
  an admin doesn't retroactively re-attribute their messages.
- The body cap is 4000 chars to match `Ticket.body`. Empty bodies rejected by
  Zod.
- No edit / delete in v1. Audit-log can quote the row id if a moderator needs
  to redact later (out of scope).

## 9. Out of scope

- Notifications (email / push) on new messages — phase 3.5.
- Attachments / photos on messages — phase 3.6 (needs object storage + presigned
  URLs).
- Edit / delete messages — needs moderation tooling; phase 3.4b.
- Read receipts / typing indicators — would need a realtime channel.
- Partner participation in the thread — partners join via `ServiceJob`, not the
  ticket thread directly.

## 10. Acceptance criteria

- [ ] Tenant can post + see their own + the owner's messages, oldest first.
- [ ] Owner sees the same thread from the owner-tickets side.
- [ ] Cross-party access returns 404.
- [ ] Admin can read any thread but cannot post.
- [ ] Closed-and-out-of-window tickets reject new messages with 409.
- [ ] Deleted ticket returns 404 on list + post.
- [ ] Author role at write time is preserved on the message row.

## 11. Manual test plan

1. As tenant: open a ticket → write "what time does the plumber arrive?" → see
   it appear immediately.
2. Switch to the owner account → open the same ticket → see the tenant's message
   → reply "Tomorrow 10am."
3. Switch back to tenant → message appears with the owner's display name.
4. As admin: open `/v1/admin/tickets/:id/messages` (or admin UI when it exists)
   → see both messages with role badges.
5. Try to POST from a different tenant's account against this ticket → 404.

## 12. Rollout

- No flag. Pure additive surface on existing ticket pages.
- Migration: forward-only, additive table — safe to apply ahead of code.
- Backfill: none.
- Comms: mention in the next changelog ("you can now chat on tickets").
