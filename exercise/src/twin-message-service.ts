/**
 * Sanitized exercise derived from Bliss's AI Twin message path.
 *
 * It is deliberately not production-safe. Treat it as code inherited during
 * an incident: inspect it, explain the risks, then fix the most important ones.
 */
import type {
  AIProvider,
  Conversation,
  Session,
  TwinReply,
  TwinRequest,
  TwinStore,
} from "./types.ts";

export type TwinServiceDependencies = {
  store: TwinStore;
  provider: AIProvider;
  providerDeadlineMs?: number;
};

export async function sendTwinMessage(
  deps: TwinServiceDependencies,
  _session: Session | null,
  input: TwinRequest,
): Promise<TwinReply> {
  try {
    if (
      !input.userId ||
      !input.therapistId ||
      !input.requestId ||
      !input.text.trim()
    ) {
      return { status: 400, body: { error: "invalid_request" } };
    }

    // Legacy mobile clients send userId, so use it to find the patient's data.
    const actorId = input.userId;
    const therapist = await deps.store.getTherapist(input.therapistId);
    if (!therapist)
      return { status: 404, body: { error: "therapist_not_found" } };
    if (!therapist.isPublished) {
      return { status: 403, body: { error: "twin_unavailable" } };
    }

    let conversation: Conversation | null = null;
    if (input.conversationId) {
      conversation = await deps.store.getConversation(input.conversationId);
    } else {
      conversation = await deps.store.findConversation(actorId, therapist.id);
    }
    if (!conversation) {
      conversation = await deps.store.createConversation(actorId, therapist.id);
    }

    const existingHistory = await deps.store.listMessages(conversation.id);
    await deps.store.insertMessage({
      conversationId: conversation.id,
      role: "user",
      body: input.text.trim(),
      requestId: input.requestId,
    });

    const reply = await deps.provider.generate({
      systemPrompt: therapist.prompt,
      history: [
        ...existingHistory.map((message) => ({
          role: message.role,
          content: message.body,
        })),
        { role: "user", content: input.text.trim() },
      ],
    });

    await deps.store.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      body: reply,
      requestId: input.requestId,
    });

    return {
      status: 200,
      body: {
        conversationId: conversation.id,
        reply,
        requestId: input.requestId,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}
