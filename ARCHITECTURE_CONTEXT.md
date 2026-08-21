# Bliss backend context for this interview

This is a sanitized, intentionally simplified map of the current Bliss backend. It contains the context needed for the interview; candidates are not expected to know Bliss beforehand.

## Runtime and data

- Bliss is a TypeScript monorepo. The main API is Hono on Node. The web application uses TanStack Start and owns a few raw streaming endpoints that are awkward to express as server functions.
- Both services use one Postgres database through Drizzle ORM and small Node `pg` pools. The inspected backend does not use Supabase or database row-level security. Authorization is therefore enforced in server code and database constraints.
- Better Auth provides cookie sessions for web and bearer sessions for mobile. A verified session identifies a `users` row. Domain records such as `customers` and `therapists` reference that user.
- Migrations are generated with Drizzle, reviewed as SQL, and applied manually in production. New and old application versions may overlap during a deployment.
- The API starts pg-boss workers backed by Postgres for delayed hold expiry and scheduled sweeps. Handlers must tolerate retries. There is no separate Redis or Kafka dependency.

## AI Twin availability and consent

A patient may start a Twin chat only when the server confirms all relevant gates:

1. The request has an authenticated session. Client-supplied identity is not authoritative.
2. The therapist exists and is published.
3. The therapist has enabled their Twin.
4. The therapist has completed the minimum persisted persona setup.
5. The patient has accepted the current disclaimer version for that therapist.

A therapist may test their own Twin before publishing/enabling it. That exception is based on exact ownership (`therapist.userId === session.user.id`), not merely a claimed role.

## One real Twin message

```text
POST /api/twin/chat (TanStack web server)
  -> Better Auth resolves session user
  -> per-user/IP in-memory rate limit
  -> validate therapist id and check availability/readiness/consent
  -> normalize and cap recent turns from the request
  -> optionally embed latest user text for pgvector knowledge retrieval
  -> load therapist bio, approaches, issues, persona answers, approved knowledge,
     and patient-specific homework into a bounded prompt
  -> find or create the per-(patient, therapist) conversation
  -> read cached conversation summary for older memory
  -> persist the latest user message
  -> run deterministic and semantic safety checks
  -> call Vertex AI Gemini in an EU region (Anthropic is an optional non-EU
     fallback only when data-residency policy permits)
  -> stream AG-UI/SSE events through an in-process resumable run registry
  -> persist the assistant message after successful stream completion
  -> asynchronously refresh the cached summary and trigger safety follow-up
```

The conversation discriminator is currently encoded as `ai-twin:<therapistId>:<userId>` in `conversations.bubble_id`. A conversation participant row also links the patient. Assistant messages have no real sender user. The current model context uses the normalized recent turns supplied by the client plus server-built prompt/memory; persisted messages are the durable history shown later.

Important current trade-offs:

- User messages are durable before generation, but assistant persistence occurs after streaming. Partial failure is possible.
- The stream-resume registry and rate limits are process-local. A restart loses in-flight resume state; multiple replicas do not share counters.
- Recent turns and individual messages are bounded for the model, and a cached summary carries older memory. The persisted conversation itself can continue growing.
- Safety combines deterministic checks, a semantic classifier, a model tool call, scripted containment, conversation locks, escalation records, and notifications. Some notification and summary work is deliberately fire-and-forget.

## Payments and bookings

The relevant current billing flow is appointment payment, not an invented recurring-subscription service.

- The client supplies an appointment id and optional promo code. The server derives the authenticated customer, owns the appointment check, price, promo revalidation, and amount.
- Stripe PaymentIntents use an idempotency key derived from the charge facts. The client success callback is not fulfillment.
- A signature-verified raw-body Stripe webhook confirms the appointment and inserts the paid ledger row in one database transaction.
- Replay protection is layered: an existing-row check, a partial unique index for paid provider intent ids, and transactional state changes.
- Duplicate or orphaned payments are recorded and flagged for reconciliation/refund rather than silently discarded. Noncritical email/video/referral work runs after the durable transaction.

## Operations, privacy, and observability

- The API has Sentry error capture when configured, Hono request logging, console-structured operational messages, and shallow health endpoints. Twin-specific metrics and distributed traces are limited compared with the importance of the flow.
- Feature flags are environment-driven. Most rate limiting is single-process.
- Conversation content is sensitive health-related data. GDPR export/deletion paths exist; deleting a user's Twin conversation cascades its messages and summaries. Financial/legal rows are retained and de-identified where appropriate.
- Production and development have separate data/auth/payment environments. Development uses synthetic data only.

## External services relevant to the interview

Vertex AI/Gemini, optional Anthropic, OpenAI embeddings, Stripe, Better Auth/Google OAuth, Postgres/pg-boss, Sentry, transactional email providers, Daily video, and optional speech providers. No credentials or real user data are required for this interview.
