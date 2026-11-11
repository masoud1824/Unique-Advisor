const ZOOM = /https?:\/\/[\w.-]*zoom\.us\/j\/[^\s)]+/i;

export function chatJoinLink(url: string) {
  const href = url.trim().replace(/[).,]+$/, "");
  if (!ZOOM.test(href)) return "";
  return `[Join Zoom meeting](${href})`;
}

export function spokenReply(text: string) {
  const had = ZOOM.test(text);
  const line = text
    .replace(/(?:Zoom join link:\s*)?\[Join Zoom meeting\]\((https?:\/\/[^)\s]+)\)/gi, "the Zoom link is in the chat")
    .replace(/Zoom join link:\s*https?:\/\/\S+/gi, "the Zoom link is in the chat")
    .replace(ZOOM, "the Zoom link is in the chat");
  const cleaned = line.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
  if (had && !/the Zoom link is in the chat/i.test(cleaned)) return `${cleaned} the Zoom link is in the chat`.trim();
  return cleaned;
}

export type ReplyPiece = { text: string } | { label: string; href: string };

export function assistantPieces(content: string): ReplyPiece[] {
  const pieces: ReplyPiece[] = [];
  const re = /(?:Zoom join link:\s*)?(?:\[Join Zoom meeting\]\((https:\/\/[^)\s]+)\)|(https?:\/\/[\w.-]*zoom\.us\/j\/[^\s)]*))/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const before = content.slice(last, match.index);
    if (before) pieces.push({ text: before });
    const href = (match[1] || match[2] || "").replace(/[).,]+$/, "");
    if (/^https:\/\/[\w.-]*zoom\.us\/j\//i.test(href)) pieces.push({ label: "Join Zoom meeting", href });
    last = match.index + match[0].length;
  }
  const rest = content.slice(last);
  if (rest) pieces.push({ text: rest });
  return pieces.length ? pieces : [{ text: content }];
}
