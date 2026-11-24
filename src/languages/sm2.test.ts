// The scheduler in applets/languages.tsx (SM-2 as Anki's v2 scheduler has it): the first intervals, lapses, the ease
// floor, overdue cards, and the line each review adds to a card. Expected days are worked by hand from Anki's rules.
import { describe, expect, it } from "vitest";
import { L } from "./applet";

const { addDays, daysBetween, formatInterval, formatReviewLine, isDue, MIN_EASE, newSm2Card, previewIntervals, scheduleCard, sm2FromFields, STARTING_EASE } = L;
type Sm2Card = Parameters<typeof scheduleCard>[0];
const GRADUATING_INTERVAL = 1, EASY_INTERVAL = 4;

const TODAY = "2026-11-23";

describe("SM-2 date helpers", () => {
  it("adds days across month, year, and leap-year boundaries without DST drift", () => {
    expect(addDays("2026-11-23", 0)).toBe("2026-11-23");
    expect(addDays("2026-11-23", 1)).toBe("2026-11-24");
    expect(addDays("2026-11-23", 8)).toBe("2026-12-01");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetween("2026-11-23", "2026-11-29")).toBe(6);
    expect(daysBetween("2026-11-29", "2026-11-23")).toBe(-6);
  });

  it("rejects malformed or impossible calendar dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("not-a-date", 1)).toThrow();
  });
});

describe("SM-2 first intervals and graduation (Anki behavior)", () => {
  it("starts a new card with ease 2.50, interval 0, due today", () => {
    const c = newSm2Card(TODAY);
    expect(c).toEqual({
      state: "new",
      due: TODAY,
      interval: 0,
      ease: STARTING_EASE,
      reps: 0,
      lapses: 0,
      lastReviewed: null,
    });
    expect(isDue(c, TODAY)).toBe(true);
  });

  it("follows Anki's first intervals on Good: new -> 1d -> 3d -> 7d -> 17d -> 42d", () => {
    let c = newSm2Card(TODAY);
    const days: number[] = [];
    for (let i = 0; i < 5; i++) { c = scheduleCard(c, "good", c.due).card; days.push(c.interval); }
    // 1; max(trunc(1×2.5)=2, hard 2 + 1)=3; trunc(3×2.5)=7; trunc(7×2.5)=17; trunc(17×2.5)=42
    expect(days).toEqual([GRADUATING_INTERVAL, 3, 7, 17, 42]);
    expect(c).toMatchObject({ state: "review", reps: 5, ease: 2.5, lapses: 0 });
    expect(scheduleCard(newSm2Card(TODAY), "good", TODAY).card.due).toBe("2026-11-24");
  });

  it("graduates a new card on Easy to 4 days, its ease as it was (Anki sets no bonus on graduating)", () => {
    const r = scheduleCard(newSm2Card(TODAY), "easy", TODAY);
    expect(r.card.state).toBe("review");
    expect(r.card.interval).toBe(EASY_INTERVAL);
    expect(r.card.due).toBe("2026-11-27");
    expect(r.card.ease).toBe(2.5);
    expect(r.card.reps).toBe(1);
  });

  it("does not penalize ease on Again or Hard during initial learning", () => {
    let c = newSm2Card(TODAY);
    // New + Again -> learning, still due today, ease untouched
    c = scheduleCard(c, "again", TODAY).card;
    expect(c.state).toBe("learning");
    expect(c.interval).toBe(0);
    expect(c.due).toBe(TODAY);
    expect(c.ease).toBe(2.5);
    expect(c.lapses).toBe(0);

    // Repeated Again in learning still does not drop ease or count as a lapse
    c = scheduleCard(c, "again", TODAY).card;
    expect(c.ease).toBe(2.5);
    expect(c.lapses).toBe(0);

    // Hard keeps it learning today (Anki repeats the step), new or learning; Good then graduates it
    const h1 = scheduleCard(newSm2Card(TODAY), "hard", TODAY).card;
    expect(h1).toMatchObject({ state: "learning", interval: 0, ease: 2.5 });
    const h2 = scheduleCard(h1, "hard", TODAY).card;
    expect(h2).toMatchObject({ state: "learning", interval: 0, ease: 2.5 });
    expect(scheduleCard(h2, "good", TODAY).card).toMatchObject({ state: "review", interval: 1 });
  });
});

describe("SM-2 lapses, relearning, and ease floor", () => {
  it("handles a lapse on a review card: increments lapses, resets reps/interval, drops ease by 0.20, enters relearning", () => {
    const mature: Sm2Card = {
      state: "review",
      due: TODAY,
      interval: 30,
      ease: 2.5,
      reps: 5,
      lapses: 0,
      lastReviewed: "2026-10-24",
    };
    const lapsed = scheduleCard(mature, "again", TODAY);
    expect(lapsed.card.state).toBe("relearning");
    expect(lapsed.card.interval).toBe(0);
    expect(lapsed.card.due).toBe(TODAY);
    expect(lapsed.card.reps).toBe(0);
    expect(lapsed.card.lapses).toBe(1);
    expect(lapsed.card.ease).toBe(2.3);
    expect(isDue(lapsed.card, TODAY)).toBe(true);

    // Failing again while already relearning does NOT double-penalize ease or lapses
    const stillRelearning = scheduleCard(lapsed.card, "again", TODAY);
    expect(stillRelearning.card.state).toBe("relearning");
    expect(stillRelearning.card.ease).toBe(2.3);
    expect(stillRelearning.card.lapses).toBe(1);

    // Passing relearning with Good returns to review at 1d (Easy: 2d), then 3d on the next Good
    const back = scheduleCard(stillRelearning.card, "good", TODAY);
    expect(back.card.state).toBe("review");
    expect(back.card.interval).toBe(1);
    expect(back.card.due).toBe("2026-11-24");
    expect(back.card.reps).toBe(1);
    expect(back.card.ease).toBe(2.3);

    expect(scheduleCard(stillRelearning.card, "easy", TODAY).card).toMatchObject({ state: "review", interval: 2, ease: 2.3 });
    expect(scheduleCard(stillRelearning.card, "hard", TODAY).card).toMatchObject({ state: "relearning", interval: 0 });
    const nextGood = scheduleCard(back.card, "good", back.card.due);
    expect(nextGood.card.interval).toBe(3);
    expect(nextGood.card.reps).toBe(2);
  });

  it("enforces the 1.30 ease floor across repeated lapses and Hard answers", () => {
    let c: Sm2Card = { state: "review", due: TODAY, interval: 10, ease: 1.5, reps: 3, lapses: 2 };
    // Lapse: 1.50 - 0.20 = 1.30
    c = scheduleCard(c, "again", TODAY).card;
    expect(c.ease).toBe(MIN_EASE);
    // Re-graduate then lapse again: must stay clamped at 1.30
    c = scheduleCard(c, "good", TODAY).card;
    c = scheduleCard(c, "again", c.due).card;
    expect(c.ease).toBe(MIN_EASE);
    expect(c.lapses).toBe(4);

    // Hard on a review card already at ease floor stays at 1.30
    const atFloor: Sm2Card = { state: "review", due: TODAY, interval: 10, ease: 1.3, reps: 4, lapses: 4 };
    const hardRes = scheduleCard(atFloor, "hard", TODAY);
    expect(hardRes.card.ease).toBe(MIN_EASE);
    expect(hardRes.card.interval).toBe(12); // trunc(10 × 1.2)
  });

  it("guarantees strictly increasing intervals Hard < Good < Easy on review cards even at ease floor", () => {
    for (const interval of [1, 2, 4, 6, 10, 30, 120]) {
      for (const ease of [1.3, 1.5, 2.5, 3.0]) {
        const card: Sm2Card = { state: "review", due: TODAY, interval, ease, reps: interval === 1 ? 1 : 3, lapses: 0 };
        const p = previewIntervals(card, TODAY);
        expect(p.again, `ivl=${interval} ease=${ease}`).toBe(0);
        expect(p.hard, `ivl=${interval} ease=${ease}`).toBeGreaterThanOrEqual(1);
        expect(p.good, `ivl=${interval} ease=${ease}`).toBeGreaterThan(p.hard);
        expect(p.easy, `ivl=${interval} ease=${ease}`).toBeGreaterThan(p.good);
      }
    }
  });

  it("gives overdue review cards Anki's overdue bonus on Good and Easy", () => {
    const due = "2026-11-13"; // 10 days overdue on 2026-11-23
    const card: Sm2Card = { state: "review", due, interval: 10, ease: 2.5, reps: 3, lapses: 0 };
    const onTime = scheduleCard({ ...card, due: TODAY }, "good", TODAY);
    const overdueGood = scheduleCard(card, "good", TODAY);
    const overdueEasy = scheduleCard(card, "easy", TODAY);
    // On time: 10 × 2.5 = 25; overdue 10d: (10 + 10/2) × 2.5 = 37.5 → 37; Easy: (10 + 10) × 2.5 × 1.3 = 65
    expect(onTime.card.interval).toBe(25);
    expect(overdueGood.card.interval).toBe(37);
    expect(overdueEasy.card.interval).toBe(65);
    // Easy works with the ease as it was, then adds 0.15: 10 × 2.5 × 1.3 = 32.5 → 32
    expect(scheduleCard({ ...card, due: TODAY }, "easy", TODAY).card).toMatchObject({ interval: 32, ease: 2.65 });
  });

  it("caps enormous intervals at MAX_INTERVAL", () => {
    const huge: Sm2Card = { state: "review", due: TODAY, interval: 30_000, ease: 2.5, reps: 20, lapses: 0 };
    const res = scheduleCard(huge, "easy", TODAY);
    expect(res.card.interval).toBe(36_500);
  });
});

describe("SM-2 field normalization and formatting", () => {
  it("normalizes missing or legacy record fields safely", () => {
    expect(sm2FromFields(undefined, TODAY)).toEqual(newSm2Card(TODAY));
    expect(sm2FromFields({ interval: 6, ease: 0.5, due: "2026-11-29" }, TODAY)).toMatchObject({
      state: "review",
      interval: 6,
      ease: MIN_EASE,
      due: "2026-11-29",
    });
    // a day that isn't on the calendar (a hand edit) is due today, not a crash on the review screen
    const odd = sm2FromFields({ interval: 3, state: "review", due: "2026-02-30" }, TODAY);
    expect(odd.due).toBe(TODAY);
    expect(() => previewIntervals(odd, TODAY)).not.toThrow();
  });

  it("formats intervals and review log lines cleanly", () => {
    expect(formatInterval(0)).toBe("now");
    expect(formatInterval(1)).toBe("1d");
    expect(formatInterval(6)).toBe("6d");
    expect(formatInterval(45)).toBe("1.5mo");
    expect(formatInterval(400)).toBe("1.1y");

    const res = scheduleCard({ state: "review", due: TODAY, interval: 1, ease: 2.5, reps: 1, lapses: 0 }, "good", TODAY);
    expect(formatReviewLine(res, "2026-11-23 14-35")).toBe(
      "- 2026-11-23 14-35 · Good · 1d → 3d · ease 2.50 · due 2026-11-26",
    );
  });
});
