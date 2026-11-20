import { createFileRoute } from "@tanstack/react-router";
import { hashCode, codesMatch } from "@/lib/codes";
import { dbSource, getSql } from "@/lib/db";
import { enforcePreviewOperator, ready } from "@/lib/advisor-db";
import { normalizeOperatorPassword, privateOperatorPassword } from "@/lib/operator-password";
import { clearOperatorCookie, endOperatorSession, operatorCookie, previewAdminLocation, readOperatorCookie, requestIsSecure, startOperatorSession } from "@/lib/operator-session";

async function savePassword(password: string) {
  await ready();
  await enforcePreviewOperator();
  const sql = await getSql();
  const hash = hashCode(password);
  const updated = await sql`update operators set code_hash = ${hash}, code_is_default = false where id = 1 returning code_hash`;
  if (!updated[0]) {
    await sql`insert into operators (id, code_hash, code_is_default) values (1, ${hash}, false)`;
  }
  const rows = await sql`select code_hash from operators where id = 1`;
  return codesMatch(String(rows[0]?.code_hash || ""), password);
}

export const Route = createFileRoute("/api/preview-operator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secure = requestIsSecure(request);
        const fail = (notice: string) =>
          new Response(null, {
            status: 303,
            headers: { Location: previewAdminLocation(request, notice) },
          });
        if (dbSource !== "pglite") return fail("The production password is not changed here.");
        const form = await request.formData();
        if (String(form.get("end") || "") === "1") {
          endOperatorSession(readOperatorCookie(request.headers.get("cookie")));
          return new Response(null, {
            status: 303,
            headers: {
              Location: previewAdminLocation(request),
              "Set-Cookie": clearOperatorCookie(secure),
            },
          });
        }
        const password = normalizeOperatorPassword(String(form.get("secret") || ""));
        const confirm = normalizeOperatorPassword(String(form.get("secret-again") || ""));
        if (password !== confirm) return fail("Those passwords do not match.");
        const problem = privateOperatorPassword(password);
        if (problem) return fail(problem);
        if (!(await savePassword(password))) return fail("The password was not saved.");
        return new Response(null, {
          status: 303,
          headers: {
            Location: previewAdminLocation(request),
            "Set-Cookie": operatorCookie(startOperatorSession(), secure),
          },
        });
      },
    },
  },
});
