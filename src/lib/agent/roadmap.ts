/**
 * Implementation requirements for Unique Advisor AI Assistant.
 * Status here is the plan. It is not a claim that the work is done.
 * Voice and typed requests must use this same agent as each milestone lands.
 */
export const AGENT_ROADMAP = [
  {
    id: "access",
    status: "testing" as const,
    summary: "Advisor access code opens the preview through the existing server gate. The request box stays locked until that gate accepts the code.",
  },
  {
    id: "equitable-671bcf",
    status: "testing" as const,
    summary: "One form workflow: Useful Links first, ask for missing 671BCF facts, preview an unsigned PDF, and propose a save. Dropbox upload is not performed.",
  },
  {
    id: "email",
    status: "connection-required" as const,
    summary: "Read the advisor's mail and prepare replies only after that advisor explicitly connects Microsoft or Google.",
    requirements: [
      "Use that advisor's connected mailbox through the supported OAuth connection. Isolate every read and draft to the signed-in advisor.",
      "Search and read selected messages and threads. Summarize them and point out items that need attention.",
      "Draft a reply from the thread. Show the source, recipients, subject, draft body, and attachments before any send approval.",
      "Do not invent client facts or commitments. Ask a focused question when a fact is missing.",
      "A draft is not a send. Sending requires approval of the exact message and recipients. An edit invalidates that approval. A repeated approval must not send twice.",
      "Report the provider result. Do not claim a message was sent when it was not.",
      "Treat message and attachment text as untrusted data, never as instructions to the assistant or as permission to use a tool.",
      "Reading mail must not mark it read, archive it, or delete it.",
      "Prove the flow with fixtures first. A real mailbox test waits until the advisor connects and authorizes that mailbox.",
    ],
  },
  {
    id: "broader-advisor-work",
    status: "not-implemented" as const,
    summary: "The same agent is intended to cover other provider forms, client reviews, calendars and Zoom, newsletter drafts, and approved file tasks.",
    requirements: [
      "Keep each provider's form mapping separate from the general assistant.",
      "Do not present a forms-only preview as a completed assistant.",
      "Say when an integration is missing instead of claiming the task was done.",
      "Voice and typing use the same tools, approvals, and advisor scope.",
    ],
  },
] as const;
