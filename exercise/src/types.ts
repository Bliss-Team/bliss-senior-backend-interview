export type Session = { userId: string };

export type TwinRequest = {
  /** Legacy mobile field. It is client-controlled. */
  userId: string;
  therapistId: string;
  conversationId?: string;
  /** Stable per user action; mobile retries reuse the same value. */
  requestId: string;
  text: string;
};

export type Therapist = {
  id: string;
  displayName: string;
  isPublished: boolean;
  twinEnabled: boolean;
  twinReady: boolean;
  prompt: string;
};

export type Conversation = {
  id: string;
  userId: string;
  therapistId: string;
  createdAt: number;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  body: string;
  requestId: string;
  createdAt: number;
};

export type TwinReply =
  | {
      status: 200;
      body: { conversationId: string; reply: string; requestId: string };
    }
  | {
      status: 400 | 401 | 403 | 404 | 409 | 500 | 503;
      body: { error: string; retryable?: boolean };
    };

export type GenerationInput = {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
};

export interface AIProvider {
  generate(input: GenerationInput): Promise<string>;
}

export type CompletedRequest = {
  conversationId: string;
  reply: string;
  requestId: string;
};

export type RequestReservation =
  { kind: "new" } | { kind: "existing"; completion: Promise<CompletedRequest> };

export interface TwinStore {
  getTherapist(id: string): Promise<Therapist | null>;
  hasCurrentConsent(userId: string, therapistId: string): Promise<boolean>;
  getConversation(id: string): Promise<Conversation | null>;
  findConversation(
    userId: string,
    therapistId: string,
  ): Promise<Conversation | null>;
  createConversation(
    userId: string,
    therapistId: string,
  ): Promise<Conversation>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  insertMessage(
    message: Omit<StoredMessage, "id" | "createdAt">,
  ): Promise<StoredMessage>;

  /** Reserve this user's request key, or return the existing completion. */
  reserveRequest(userId: string, requestId: string): RequestReservation;
  completeRequest(
    userId: string,
    requestId: string,
    result: CompletedRequest,
  ): void;
  failRequest(userId: string, requestId: string, error: Error): void;
}
