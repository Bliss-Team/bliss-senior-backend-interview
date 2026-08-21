import type {
  AIProvider,
  CompletedRequest,
  Conversation,
  GenerationInput,
  RequestReservation,
  StoredMessage,
  Therapist,
  TwinStore,
} from "./types.ts";

type Pending = {
  promise: Promise<CompletedRequest>;
  resolve: (value: CompletedRequest) => void;
  reject: (error: Error) => void;
};

export class FakeTwinStore implements TwinStore {
  readonly therapists = new Map<string, Therapist>();
  readonly conversations: Conversation[] = [];
  readonly messages: StoredMessage[] = [];
  readonly consents = new Set<string>();
  private readonly requests = new Map<string, Pending>();
  private sequence = 0;

  grantConsent(userId: string, therapistId: string): void {
    this.consents.add(`${userId}:${therapistId}:v2`);
  }

  async getTherapist(id: string): Promise<Therapist | null> {
    return this.therapists.get(id) ?? null;
  }

  async hasCurrentConsent(
    userId: string,
    therapistId: string,
  ): Promise<boolean> {
    return this.consents.has(`${userId}:${therapistId}:v2`);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return (
      this.conversations.find((conversation) => conversation.id === id) ?? null
    );
  }

  async findConversation(
    userId: string,
    therapistId: string,
  ): Promise<Conversation | null> {
    return (
      this.conversations.find(
        (conversation) =>
          conversation.userId === userId &&
          conversation.therapistId === therapistId,
      ) ?? null
    );
  }

  async createConversation(
    userId: string,
    therapistId: string,
  ): Promise<Conversation> {
    const row: Conversation = {
      id: `conv-${++this.sequence}`,
      userId,
      therapistId,
      createdAt: Date.now(),
    };
    this.conversations.push(row);
    return row;
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.messages
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async insertMessage(
    message: Omit<StoredMessage, "id" | "createdAt">,
  ): Promise<StoredMessage> {
    const row: StoredMessage = {
      ...message,
      id: `msg-${++this.sequence}`,
      createdAt: Date.now() + this.sequence,
    };
    this.messages.push(row);
    return row;
  }

  reserveRequest(userId: string, requestId: string): RequestReservation {
    const key = `${userId}:${requestId}`;
    const existing = this.requests.get(key);
    if (existing) return { kind: "existing", completion: existing.promise };

    let resolve!: (value: CompletedRequest) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<CompletedRequest>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Avoid an unhandled rejection if a failed first request has no waiter.
    void promise.catch(() => undefined);
    this.requests.set(key, { promise, resolve, reject });
    return { kind: "new" };
  }

  completeRequest(
    userId: string,
    requestId: string,
    result: CompletedRequest,
  ): void {
    this.requests.get(`${userId}:${requestId}`)?.resolve(result);
  }

  failRequest(userId: string, requestId: string, error: Error): void {
    const key = `${userId}:${requestId}`;
    const pending = this.requests.get(key);
    if (!pending) return;
    pending.reject(error);
    this.requests.delete(key);
  }
}

export class FakeAIProvider implements AIProvider {
  calls: GenerationInput[] = [];
  reply = "I hear you. What feels most important right now?";
  delayMs = 0;
  blockUntilAborted = false;
  error: Error | null = null;

  async generate(input: GenerationInput): Promise<string> {
    this.calls.push(input);
    if (this.blockUntilAborted) {
      await new Promise<void>((resolve, reject) => {
        if (input.signal?.aborted) {
          reject(input.signal.reason ?? new Error("aborted"));
          return;
        }
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
        // Without a signal this intentionally never settles.
        if (!input.signal) void resolve;
      });
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.error) throw this.error;
    return this.reply;
  }
}

export function makeTherapist(overrides: Partial<Therapist> = {}): Therapist {
  return {
    id: "therapist-1",
    displayName: "Dr. Mira",
    isPublished: true,
    twinEnabled: true,
    twinReady: true,
    prompt:
      "You are a bounded AI support tool modeled on Dr. Mira's communication style.",
    ...overrides,
  };
}
