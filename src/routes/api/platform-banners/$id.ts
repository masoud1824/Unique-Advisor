import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

function bannerBytes(data: string) {
  const text = data.trim();
  const marked = text.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  const payload = marked ? marked[2] : /^[A-Za-z0-9+/=\s]+$/.test(text) ? text : "";
  if (!payload) return null;
  const bytes = Uint8Array.from(Buffer.from(payload.replace(/\s/g, ""), "base64"));
  if (bytes.length < 32) return null;
  const type = marked?.[1] === "image/png" ? "image/png" : marked?.[1] === "image/webp" ? "image/webp" : "image/jpeg";
  return { bytes, type };
}

export const Route = createFileRoute("/api/platform-banners/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const fromPath = new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";
        const id = Number(params.id || fromPath);
        if (!Number.isInteger(id) || id < 1) return new Response("Not found", { status: 404 });
        const sql = await getSql();
        const rows = await sql<{ image_data: string }>`
          select image_data from platform_templates where id = ${id} and kind = 'banner'
        `;
        const picture = bannerBytes(rows[0]?.image_data ?? "");
        if (!picture) return new Response("Not found", { status: 404 });
        return new Response(picture.bytes, {
          headers: {
            "Content-Type": picture.type,
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
