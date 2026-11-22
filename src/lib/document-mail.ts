export const DOCUMENT_MAIL = {
  recipient: "reviewer@example.invalid",
  title: "Signature Workflow Test",
  subject: "Signature Workflow Test — fictional document",
  body: "This is a fictional test email, not a client message. The attachment is the Signature Workflow Test document from the test folder.",
};

export const MAIL_MONITORING = "Reply monitoring runs only while this preview process is awake. It does not run while the preview sleeps. Replies that arrive during sleep are checked the next time the preview is awake and this advisor opens the desk. Each new reply in this thread creates one notification.";

export type MailAttachment = { path: string; name: string; size: number; hash: string };
export type ThreadMessage = { id: string; conversationId: string; from: string };

export const REVIEWED_ADVISOR = "masoud-zangeneh-2";
export const REVIEWED_ATTACHMENT: MailAttachment = {
  path: "/Unique Advisor/Assistant Test/Signature Workflow Test.pdf",
  name: "Signature Workflow Test.pdf",
  size: 1102,
  hash: "11e40bac6227b9ef72ce123c134376fe7699af341a8331f7d0e8b7db9d9c77c5",
};
export const REVIEWED_APPROVAL = "I approve this exact preview";

export function documentMailPreview(input: { sender: string; attachment: MailAttachment }) {
  const sender = input.sender.trim();
  const file = input.attachment;
  if (!sender.includes("@")) return { ok: false as const, error: "This advisor has no connected mailbox. I did not use another advisor's mailbox, and nothing was sent." };
  if (!file.path.startsWith("/Unique Advisor/Assistant Test/")) return { ok: false as const, error: "The attachment is not in the test folder. Nothing was sent." };
  return {
    ok: true as const,
    preview: [
      `From: ${sender}`,
      `To: ${DOCUMENT_MAIL.recipient}`,
      `Subject: ${DOCUMENT_MAIL.subject}`,
      `Body: ${DOCUMENT_MAIL.body}`,
      `Attachment: ${file.path}`,
      `Attachment name: ${file.name}`,
      `Attachment size: ${file.size} bytes`,
      `Attachment hash: ${file.hash}`,
      "This email has not been sent. I will wait for your approval of this exact preview.",
      MAIL_MONITORING,
    ].join("\n"),
  };
}

export function samePreview(approved: string, shown: string) {
  return shown.length > 0 && approved.trim() === shown.trim();
}

export function reviewedTestDecision(input: {
  advisorSlug: string;
  sender: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  attachment: MailAttachment;
  approvalText: string;
  alreadySent: boolean;
}) {
  if (input.advisorSlug !== REVIEWED_ADVISOR) return { ok: false as const, error: "That advisor is not part of this test. Nothing was sent." };
  const sender = input.sender.trim().toLowerCase();
  if (!sender.includes("@")) return { ok: false as const, error: "This advisor has no connected mailbox. Nothing was sent." };
  const to = input.to.map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (to.length !== 1 || to[0] !== DOCUMENT_MAIL.recipient) return { ok: false as const, error: "Only reviewer@example.invalid can receive this test. Nothing was sent." };
  if ((input.cc || []).some((item) => item.trim()) || (input.bcc || []).some((item) => item.trim())) {
    return { ok: false as const, error: "CC and BCC are not allowed for this test. Nothing was sent." };
  }
  const file = input.attachment;
  const reviewed = REVIEWED_ATTACHMENT;
  if (file.path !== reviewed.path || file.name !== reviewed.name || file.size !== reviewed.size || file.hash !== reviewed.hash) {
    return { ok: false as const, error: "The attachment is not the reviewed version. Nothing was sent." };
  }
  if (input.approvalText.trim() !== REVIEWED_APPROVAL) return { ok: false as const, error: "This test needs an explicit approval of the exact preview. Nothing was sent." };
  if (input.alreadySent) return { ok: false as const, error: "This email was already sent. It was not sent again." };
  const preview = documentMailPreview({ sender: input.sender.trim(), attachment: file });
  if (!preview.ok) return preview;
  return {
    ok: true as const,
    preview: preview.preview,
    message: {
      subject: DOCUMENT_MAIL.subject,
      body: { contentType: "Text" as const, content: DOCUMENT_MAIL.body },
      toRecipients: [{ emailAddress: { address: DOCUMENT_MAIL.recipient } }],
      attachments: [{ name: reviewed.name, contentType: "application/pdf" }],
    },
  };
}

export function planReplyNotices(input: { conversationId: string; sentMessageId: string; sender: string; seen: string[]; messages: ThreadMessage[] }) {
  const sender = input.sender.trim().toLowerCase();
  const seen = new Set(input.seen);
  const notices = [];
  for (const message of input.messages) {
    if (message.conversationId !== input.conversationId) continue;
    if (!message.id || message.id === input.sentMessageId || seen.has(message.id)) continue;
    if (message.from.trim().toLowerCase() === sender) continue;
    notices.push({
      messageId: message.id,
      body: `New reply in the ${DOCUMENT_MAIL.title} email thread.`,
    });
    seen.add(message.id);
  }
  return notices;
}

export function noticesToCreate(planned: { messageId: string; body: string }[], storedIds: string[]) {
  const stored = new Set(storedIds);
  const created: { messageId: string; body: string }[] = [];
  for (const notice of planned) {
    if (!notice.messageId || stored.has(notice.messageId)) continue;
    stored.add(notice.messageId);
    created.push(notice);
  }
  return created;
}
