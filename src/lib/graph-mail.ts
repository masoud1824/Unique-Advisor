/** Pure Microsoft Graph mail request shapes. No database and no network. */

export function graphConversationMessagesUrl(conversationId: string) {
  const filter = `conversationId eq '${String(conversationId || "").replace(/'/g, "''")}'`;
  return `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,conversationId,from`;
}

export function graphSendMailBody(input: { to: string; subject: string; html: string }) {
  return {
    message: {
      subject: input.subject,
      body: { contentType: "HTML" as const, content: input.html },
      toRecipients: [{ emailAddress: { address: input.to } }],
    },
    saveToSentItems: true,
  };
}
