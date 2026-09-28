import { z } from "zod/v4";

export const AgentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(6_000),
});

export const AgentChatBodySchema = z.object({
  messages: z.array(AgentMessageSchema).min(1).max(40),
}).strict();

export type AgentChatMessage = z.infer<typeof AgentMessageSchema>;

const FOLLOW_UP_REFERENCE_PATTERN =
  /\b(desses?|deles?|delas?|essas?|esses?|estas?|estes?|qual deles|qual delas|entre eles|entre elas|os \d+|as \d+|dos \d+|das \d+)\b/i;
const ELLIPTICAL_COHORT_FOLLOW_UP_PATTERN =
  /\b(quantos|quantas)\s+(sao|foram|eram)\s+(mulheres|homens)\b/i;

/**
 * Keeps the clinical filters from the previous turn when the doctor asks a
 * referential follow-up such as "quantos desses 4...". The model receives the
 * complete conversation separately; this context is only for the server-side
 * deterministic filter enrichment.
 */
export function buildClinicalFilterContext(
  messages: AgentChatMessage[],
): string {
  const userMessages = messages.filter((message) => message.role === "user");
  const lastMessage = userMessages.at(-1)?.content ?? "";

  const normalizedLastMessage = lastMessage
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (
    !FOLLOW_UP_REFERENCE_PATTERN.test(lastMessage) &&
    !ELLIPTICAL_COHORT_FOLLOW_UP_PATTERN.test(normalizedLastMessage)
  ) {
    return lastMessage;
  }

  return userMessages
    .slice(-4)
    .map((message) => message.content)
    .join("\n");
}