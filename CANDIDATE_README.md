# Senior Backend Engineer — Bliss AI Twin

## Format

This is a maximum 75-minute working session based on a sanitized model of the real Bliss backend. It is not a trivia or syntax test. You are not expected to know Bliss before today and you will receive all local context needed to reason about the tasks.

This is **not a LeetCode-style interview**. You are evaluated on debugging, backend reasoning, production judgment, security, reliability, prioritization, communication, and how you use your tools. Explain important reasoning while you work. You are not expected to fix every issue during the available time.

All names, metrics, timestamps, incident evidence, and records in this repository are sanitized or synthetic. Nothing here is production data.

Target schedule:

| Stage                                 |       Time |
| ------------------------------------- | ---------: |
| 1. Codebase orientation               |  7 minutes |
| 2. Production debugging/coding        | 28 minutes |
| 3. Production incident                | 15 minutes |
| 4. Architecture and product evolution | 15 minutes |
| 5. Your questions                     |  5 minutes |
| Buffer                                |  5 minutes |

## AI and normal tools are allowed

**You may use ChatGPT, Claude, Codex, Copilot, Google, documentation, Stack Overflow, or any other normal development tool during the interview.**

We are not testing memorized syntax. Using AI well is a positive signal when you frame the problem clearly, verify suggestions, identify unsafe output, and remain in control. You must be able to explain and defend any code or decision you adopt.

## Stage 1 — Orientation

Read [ARCHITECTURE_CONTEXT.md](./ARCHITECTURE_CONTEXT.md), then inspect the files under `exercise/`.

As you inspect, narrate briefly:

- where identity and authorization should be established;
- what data must remain isolated;
- where duplicate delivery or partial failure can occur;
- what you would examine first if this were an unfamiliar production service.

Do not start editing until the interviewer starts Stage 2.

## Stage 2 — Production debugging and coding

The `exercise/` directory is a credential-free TypeScript model of the authenticated AI Twin message flow. It has an in-memory store and fake AI provider. The current implementation is intentionally not production-safe.

Run:

```bash
cd exercise
npx npm@10.9.2 install
npm test
```

Some tests fail initially by design. You are not expected to make every test pass in 28 minutes.

Your task, in order:

1. Inspect the implementation and tests.
2. State the important risks you see and rank them. Explain what can harm a user, leak data, corrupt state, charge cost, or make recovery difficult.
3. Implement the highest-priority fixes you can complete safely.
4. Run relevant tests and explain what they prove—and what they do not prove.
5. In the final two minutes, explain the next changes you would make before trusting this path in production.

Constraints:

- Do not remove tests or weaken assertions.
- Do not solve failures by removing integrity or access checks.
- You may change any file under `exercise/`.
- A minimal, well-reasoned fix is better than a large rewrite.
- You may ask the interviewer factual questions, but all intended architecture context is already in this package.

Tests do not enumerate every issue. Treat passing tests as evidence, not proof of production safety.

## Stage 3 — Fixed production incident

It is 10:14 local time. You are the backend incident owner. This packet is complete; ask for an item if you want it and the interviewer will point you to the fixed evidence below.

### Timeline

| Time  | Evidence                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 10:02 | Release `web-api-2026.08.21.1` completed. Database migrations: none.                                     |
| 10:05 | Stripe webhook non-2xx rate rises from 0% to 96%.                                                        |
| 10:07 | Support reports two patients paid but still see “payment pending”; their appointment rows remain `hold`. |
| 10:08 | Twin provider 429s rise sharply in the EU region.                                                        |
| 10:10 | Twin completion success falls from 98.7% to 61%; p95 first response grows from 2.4s to 14.8s.            |
| 10:12 | On-call declares one incident because payment correctness and Twin availability are both user-visible.   |

### Current metrics

```text
API /api/stripe/webhook: 96% 400, 4% 2xx, 0% 5xx
API /api/payments/sheet: 99.4% 2xx, latency normal
Web /api/twin/chat: 27% RUN_ERROR, 12% request 503, latency elevated
Postgres CPU: 31%; lock waits and pool waits normal
API and web healthz: green
Vertex EU provider: 429 rate 38%, provider status reports regional quota degradation
Sentry: no new database exception cluster
```

### Relevant deployment diff

```diff
 app.use("*", async (c, next) => {
+  if (c.req.method === "POST") {
+    const parsed = await c.req.json().catch(() => null);
+    console.log("request", c.req.path, redact(parsed));
+  }
   await next();
 });

 // Stripe route, unchanged
 stripeRoute.post("/webhook", async (c) => {
   return handleStripeWebhook(c.req.raw);
 });

 // handleStripeWebhook, unchanged
 const rawBody = await request.text();
 event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
```

No Twin code changed in this release.

### Logs

```text
10:11:04 POST /api/stripe/webhook 400 3ms
10:11:04 webhook signature verification failed: TypeError: Body is unusable
10:11:09 POST /api/stripe/webhook 400 2ms

10:11:12 twin generation failed provider_status=429 region=eu retry_after=18
10:11:13 twin generation failed provider_status=429 region=eu retry_after=17
```

The request logger output contains only field names and sizes after redaction; no raw payment or patient content is shown in this packet.

### Database snapshot at 10:13

```text
appointments status=hold and stripe_payment_intent_id set: 7
of those, Stripe dashboard says succeeded: 3
paid payments rows for those 3 intent ids: 0
duplicate paid provider_payment_id rows: 0
Twin user messages without a following assistant message in last 15m: 41
```

### Deployment and dependency facts

- The previous release is available for immediate rollback; there was no schema migration.
- Stripe signatures require the exact raw request body. Stripe retries non-2xx webhook deliveries.
- Appointment confirmation is webhook-only. Client success must not be treated as fulfillment.
- The paid ledger has a unique constraint on successful Stripe intent id and the webhook transaction is replay-safe.
- EU patient text must not be failed over to a non-EU AI provider.
- The global Twin UI flag can be turned off, but already-open clients may still call the endpoint.

### Questions

Talk through your actions in order:

1. What do you do in the first five minutes? Would you rollback?
2. What is the blast radius, and what do you protect immediately?
3. Which symptoms share a cause and which may not?
4. What evidence would you preserve or query before changing state?
5. How do you handle the three succeeded-but-unconfirmed payments without creating double fulfillment or refunds?
6. How do you reduce Twin harm and cost while the provider is degraded?
7. What do you communicate internally, and at what cadence?
8. How do you verify recovery? What follow-up work is required?

## Stage 4 — Evolve this architecture

Assume Twin traffic grows 10× over six months. Daily active conversations grow from thousands to tens of thousands; many conversations become long; the product remains a sensitive health-support tool. Start from the architecture in `ARCHITECTURE_CONTEXT.md` rather than designing a new company from scratch.

Explain:

- what you would keep;
- the first two or three changes you would make and the measurements that justify them;
- what you explicitly would not introduce yet;
- how you would handle conversation storage and retrieval, bounded LLM context/memory, provider reliability, authentication/authorization, rate limits, observability, privacy, cost, and safe deploys;
- which operations must stay synchronous and which may move to durable asynchronous work.

Do not receive credit merely for naming a technology. For every material component, explain the problem it solves, added failure modes/complexity, and why the timing is justified.

### Fixed follow-up constraints

1. Vertex returns 429s for 20 minutes in the required EU region. Product asks you to “just retry five times or switch providers.” What do you do?
2. Postgres query latency is healthy, but connection usage and message-table I/O are approaching their limits. What evidence separates indexing/pooling fixes from a need to partition or archive?
3. You must add a non-null `client_request_id` with uniqueness semantics to a large live message path while old and new application versions overlap. Describe a zero-downtime rollout and rollback.

### Product decision

A proposed reliability change lowers failed Twin turns from 3.0% to 0.5% but makes successful p95 responses three seconds slower. How would you decide whether to ship it? State the user and business measures, experiment or rollout, guardrails, and reversal criteria you would use.

## Stage 5 — Your questions

The final five minutes are yours. You may ask about the role, product ownership, team, reliability expectations, or anything else relevant to deciding whether you want the job.
