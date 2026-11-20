import { createFileRoute } from "@tanstack/react-router";
import { SIGNATURE_TEST } from "@/lib/signature-test-preview";
import { sendApprovedSignatureTest } from "@/lib/signature-test-send";

export const Route = createFileRoute("/api/signature-test/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as { approve?: string; slug?: string } | null;
        if (body?.approve !== SIGNATURE_TEST.title || body.slug !== SIGNATURE_TEST.advisorSlug) {
          return Response.json({ ok: false, error: "This send is only for the approved TEST ONLY preview." }, { status: 400 });
        }
        const result = await sendApprovedSignatureTest();
        return Response.json(result, { status: result.ok ? 200 : 400 });
      },
    },
  },
});
