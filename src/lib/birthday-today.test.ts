import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { birthdayCardReport, claimKey, todaysBirthdayReport, type BirthdayPerson } from "./birthday-job.ts";

describe("today's birthday report", () => {
  it("uses the advisor date and a real claim, and does not guess a send", () => {
    const people: BirthdayPerson[] = [
      { contactId: "1", name: "Ada Sample", email: "ada@example.invalid", birthday: "1990-11-23", unsubscribed: false },
      { contactId: "2", name: "Bea Sample", email: "bea@example.invalid", birthday: "1991-01-02", unsubscribed: false },
      { contactId: "3", name: "Cal Sample", email: "cal@example.invalid", birthday: "1980-11-23", unsubscribed: false },
    ];
    const now = new Date("2026-11-23T15:00:00Z");
    const report = todaysBirthdayReport({
      advisorId: 7,
      people,
      claims: [{ key: claimKey(7, "1", "2026"), status: "accepted" }, { key: claimKey(7, "3", "2026"), status: "failed" }],
      now,
      timeZone: "America/Toronto",
      feb29: "skip",
    });
    assert.equal(report.date, "2026-11-23");
    assert.deepEqual(report.people.map((person) => [person.name, person.card]), [
      ["Ada Sample", "sent"],
      ["Cal Sample", "failed"],
    ]);
    assert.equal(birthdayCardReport(null), "not sent");
    assert.equal(birthdayCardReport("claimed"), "unavailable");
    const nextDay = todaysBirthdayReport({ advisorId: 7, people, claims: [], now: new Date("2026-11-24T15:00:00Z"), timeZone: "America/Toronto", feb29: "skip" });
    assert.equal(nextDay.people.length, 0);
  });
});
