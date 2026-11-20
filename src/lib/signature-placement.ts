export function fictionalAddress(email: string) {
  return /@test\.invalid$/i.test(String(email || "").trim());
}

export function placementPreview(input: {
  path: string;
  edition: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signerName: string;
  deliveryEmail: string;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
}) {
  const email = String(input.deliveryEmail || "").trim();
  if (!String(input.signerName || "").trim()) return { ok: false as const, error: "Choose the signer. I did not guess who signs." };
  if (!input.edition) return { ok: false as const, error: "The form edition is not visible in the footer. I did not guess it." };
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > input.pageCount) return { ok: false as const, error: "Choose a page on this PDF." };
  if (!(input.width >= 8) || !(input.height >= 8)) return { ok: false as const, error: "Draw the signature field on the page. I did not guess a position or use “Signed at (city)”." };
  if (input.x < -1 || input.y < -1 || input.x + input.width > input.pageWidth + 1 || input.y + input.height > input.pageHeight + 1) {
    return { ok: false as const, error: "That box does not sit on the page." };
  }
  if (fictionalAddress(email)) {
    return { ok: false as const, error: "That email is fictional test data. I did not send to it. A delivery test must use your approved test email and a fresh preview." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "Enter the delivery email. Nothing was sent." };
  const box = [input.x, input.y, input.width, input.height].map((value) => Math.round(value));
  return {
    ok: true as const,
    preview: [
      `Document: ${input.path}`,
      `Edition from the visible footer: ${input.edition}`,
      `Signer: ${input.signerName.trim()}`,
      `Delivery email: ${email}`,
      `Signature field: page ${input.page}, x ${box[0]}, y ${box[1]}, width ${box[2]}, height ${box[3]}. You placed this box on the PDF. “Signed at (city)” was not used.`,
      "Destination: /Unique Advisor/Assistant Test/C-1001",
      "This is a fresh preview. The existing PDF was not changed. Nothing was sent.",
    ].join("\n"),
  };
}
