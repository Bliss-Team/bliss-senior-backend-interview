import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeAIProvider, FakeTwinStore, makeTherapist } from "../src/fakes.ts";
import { sendTwinMessage } from "../src/twin-message-service.ts";
import type { TwinRequest } from "../src/types.ts";

const USER_A = "user-a";
const USER_B = "user-b";

function setup() {
  const store = new FakeTwinStore();
  const provider = new FakeAIProvider();
  const therapist = makeTherapist();
  store.therapists.set(therapist.id, therapist);
  store.grantConsent(USER_A, therapist.id);
  return { store, provider, therapist };
}

function request(overrides: Partial<TwinRequest> = {}): TwinRequest {
  return {
    userId: USER_A,
    therapistId: "therapist-1",
    requestId: "request-1",
    text: "I have been anxious all week.",
    ...overrides,
  };
}

describe("sendTwinMessage", () => {
  it("completes a valid first turn", async () => {
    const { store, provider } = setup();
    const result = await sendTwinMessage(
      { store, provider },
      { userId: USER_A },
      request(),
    );

    assert.equal(result.status, 200);
    assert.equal(provider.calls.length, 1);
    assert.deepEqual(
      store.messages.map((message) => message.role),
      ["user", "assistant"],
    );
  });

  it("treats the authenticated session as the identity authority", async () => {
    const { store, provider } = setup();
    const result = await sendTwinMessage(
      { store, provider },
      { userId: USER_B },
      request({ userId: USER_A }),
    );

    assert.equal(result.status, 403);
    assert.equal(provider.calls.length, 0);
    assert.equal(store.messages.length, 0);
  });

  it("does not cross an existing conversation boundary", async () => {
    const { store, provider, therapist } = setup();
    store.grantConsent(USER_B, therapist.id);
    const otherConversation = await store.createConversation(
      USER_B,
      therapist.id,
    );

    const result = await sendTwinMessage(
      { store, provider },
      { userId: USER_A },
      request({ conversationId: otherConversation.id }),
    );

    assert.equal(result.status, 403);
    assert.equal(provider.calls.length, 0);
    assert.equal((await store.listMessages(otherConversation.id)).length, 0);
  });

  it("requires every server-side availability gate before side effects", async () => {
    for (const unavailable of [
      makeTherapist({ twinEnabled: false }),
      makeTherapist({ twinReady: false }),
    ]) {
      const { store, provider } = setup();
      store.therapists.set(unavailable.id, unavailable);
      const result = await sendTwinMessage(
        { store, provider },
        { userId: USER_A },
        request(),
      );
      assert.equal(result.status, 403);
      assert.equal(provider.calls.length, 0);
      assert.equal(store.messages.length, 0);
    }
  });

  it("requires current per-therapist consent", async () => {
    const { store, provider } = setup();
    store.consents.clear();

    const result = await sendTwinMessage(
      { store, provider },
      { userId: USER_A },
      request(),
    );

    assert.equal(result.status, 403);
    assert.equal(provider.calls.length, 0);
    assert.equal(store.conversations.length, 0);
  });

  it("coalesces concurrent delivery of the same user action", async () => {
    const { store, provider } = setup();
    provider.delayMs = 20;

    const [first, second] = await Promise.all([
      sendTwinMessage({ store, provider }, { userId: USER_A }, request()),
      sendTwinMessage({ store, provider }, { userId: USER_A }, request()),
    ]);

    assert.equal(first.status, 200);
    assert.deepEqual(second, first);
    assert.equal(provider.calls.length, 1);
    assert.equal(store.conversations.length, 1);
    assert.equal(
      store.messages.filter((message) => message.role === "user").length,
      1,
    );
    assert.equal(
      store.messages.filter((message) => message.role === "assistant").length,
      1,
    );
  });

  it("ends a stalled provider call with a safe retryable response", async () => {
    const { store, provider } = setup();
    provider.blockUntilAborted = true;

    const outcome = await Promise.race([
      sendTwinMessage(
        { store, provider, providerDeadlineMs: 10 },
        { userId: USER_A },
        request(),
      ),
      new Promise<"test_timeout">((resolve) =>
        setTimeout(() => resolve("test_timeout"), 80),
      ),
    ]);

    assert.notEqual(
      outcome,
      "test_timeout",
      "the provider call was left unbounded",
    );
    if (outcome === "test_timeout") return;
    assert.equal(outcome.status, 503);
    assert.deepEqual(outcome.body, {
      error: "provider_unavailable",
      retryable: true,
    });
    assert.equal(
      store.messages.filter((message) => message.role === "assistant").length,
      0,
    );
  });
});
