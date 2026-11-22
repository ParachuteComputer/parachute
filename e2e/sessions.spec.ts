// Sessions (applets/sessions.tsx): the Claude Code sessions Uni runs, read from the run notes and steps notes mts writes
// into the vault, per room: what is working now and what it is doing, how the recent ones ended and what they cost, and
// a session step by step, every word through the redactor. Read-only. (Every run, room and line here is made up.)
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const day = new Date().toISOString().slice(0, 10);

test("Sessions: working now, per room, how each ended and what it cost, and a session's steps with a secret hidden", async ({ page }) => {
  const made: string[] = [];
  const mk = async (args: Record<string, unknown>) => { const r = await record(hubState(), "create", { extension: "md", ...args }); made.push(r.id); return r; };
  try {
    const feed = await mk({ path: `Runs/Steps/${day} aaaa1111`, tags: ["run-feed"], fields: { first: 0, total: 4, parts: [], dropped: 0 },
      body: ["# Steps", "", `- ${ago(9)} · said · Reading the garden notes first.`, `- ${ago(8)} · step · Reading beds.md`,
        `- ${ago(7)} · step · Running curl -H Authorization: Bearer abc`, `- ${ago(6)} · said · the key is sk-ant-zzzzzzzzzzzz so`].join("\n") });
    await mk({ path: `Runs/${day} T-9: Plan the spring beds`, tags: ["run"], body: "# Plan the spring beds",
      fields: { state: "running", room: "garden", task: "T-9", started_at: ago(10), doing_now: "Editing beds.md", doing_at: ago(1), steps: 2, feed: feed.id } });
    await mk({ path: `Runs/${day} T-8: Order seeds`, tags: ["run"], body: "# Order seeds",
      fields: { state: "done", room: "garden", task: "T-8", started_at: ago(200), ended_at: ago(150), summary: "Seeds ordered", cost: 3.456, model: "claude-opus-5-5",
        report: { summary: "Ordered the seeds from the list.", open: "Uni: check the delivery date" } } });
    await mk({ path: `Runs/${day} T-7: Fix the gate`, tags: ["run"], body: "# Fix the gate",
      fields: { state: "blocked", room: "shed", task: "T-7", started_at: ago(400), ended_at: ago(380), summary: "Needs the right hinge", cost: 12.5 } });
    // still says running, but no one has heard from it for three hours: silent, not working
    await mk({ path: `Runs/${day} T-6: Sort the tools`, tags: ["run"], body: "# Sort the tools",
      fields: { state: "running", room: "shed", task: "T-6", started_at: ago(300), doing_now: "Reading tools.md", doing_at: ago(180), steps: 9 } });
    // a steps note is no session of its own
    made.push((await record(hubState(), "create", appletRecord("sessions"))).id);

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Sessions/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Runs/");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame:visible");

    // working now: one, with what it is doing; the silent one isn't
    const now = app.getByRole("region", { name: "Working now" });
    await expect(now.getByRole("button")).toHaveCount(1);
    await expect(now).toContainText("Plan the spring beds");
    await expect(now).toContainText("#garden · Editing beds.md");
    // per room, each with how it ended and what it cost
    const garden = app.getByRole("region", { name: "#garden" }), shed = app.getByRole("region", { name: "#shed" });
    await expect(garden).toContainText("Order seeds");
    await expect(garden).not.toContainText("Plan the spring beds");
    await expect(garden).toContainText("$3.46");
    await expect(shed).toContainText("Needs you");
    await expect(shed).toContainText("$13");
    await expect(shed).toContainText("Silent");

    // a finished one: its facts and report
    await garden.getByRole("button", { name: /Order seeds/ }).click();
    await expect(app.getByText(/Finished · #garden · started .* \$3\.46 · claude-opus-5-5 · T-8/)).toBeVisible();
    await expect(app.getByRole("region", { name: "What it did" }).or(app.getByText("Ordered the seeds from the list."))).toBeVisible();
    await expect(app.getByText("Uni: check the delivery date")).toBeVisible();
    await app.getByRole("button", { name: /Sessions/ }).first().click();

    // the working one, step by step: a step only as its phrase, a secret hidden
    await now.getByRole("button", { name: /Plan the spring beds/ }).click();
    await expect(app.getByText("Now: Editing beds.md")).toBeVisible();
    const steps = app.getByRole("region", { name: "Steps" });
    await expect(steps).toContainText("Reading the garden notes first.");
    await expect(steps).toContainText("Reading beds.md");
    await expect(steps).toContainText("Running a command");
    await expect(steps).toContainText("the key is [hidden]");
    await expect(steps).not.toContainText("Bearer");
    await expect(steps).not.toContainText("sk-ant");
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});

// Review of #162: every word of a run note goes through the redactor, not only the steps; a long session's earlier part
// loads; and steps written while the person was elsewhere show when they come back.
test("Sessions: a secret in any field of a run is hidden; earlier steps load from a part; new steps show on return", async ({ page }) => {
  const made: string[] = [];
  const mk = async (args: Record<string, unknown>) => { const r = await record(hubState(), "create", { extension: "md", ...args }); made.push(r.id); return r; };
  const KEY = "sk-ant-qqqqqqqqqqqqqqqq";
  try {
    const part = await mk({ path: `Runs/Steps/${day} bbbb2222 part 0`, tags: ["run-feed"], fields: { first: 0, n: 3 },
      body: ["# Steps, part 0", "", `- ${ago(30)} · said · first line`, `- ${ago(29)} · said · second line`, `- ${ago(28)} · said · third line`].join("\n") });
    const head = ["# Steps", "", `- ${ago(20)} · said · fourth line`, `- ${ago(19)} · said · fifth line`];
    const feed = await mk({ path: `Runs/Steps/${day} bbbb2222`, tags: ["run-feed"], fields: { first: 3, total: 5, parts: [{ id: part.id, first: 0, n: 3 }], dropped: 0 }, body: head.join("\n") });
    await mk({ path: `Runs/${day} Fix the hinge token ${KEY}`, tags: ["run"], body: "# x",
      fields: { state: "running", room: "sk-ant-zzzzzzzzzzzzzzzz", model: "sk-ant-api03-abcdefabcdef", task: "T-5", started_at: ago(40), doing_now: `Running curl -H "Bearer ${KEY}"`, doing_at: ago(1), steps: 2, feed: feed.id,
        report: { open: `password=${KEY}` }, end_note: `token ${KEY}`, summary: `secret ${KEY}` } });
    made.push((await record(hubState(), "create", appletRecord("sessions"))).id);

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Sessions/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame:visible");
    const now = app.getByRole("region", { name: "Working now" });
    await expect(now).toContainText("Fix the hinge [hidden]");
    await expect(now).toContainText("#no room · Running a command");
    await now.getByRole("button").first().click();
    await expect(app.getByText("fifth line")).toBeVisible();
    const body = app.locator("body");
    await expect(body).not.toContainText("sk-ant");
    await expect(body).not.toContainText("Bearer");

    // the earlier part, in front, every line once
    await app.getByRole("button", { name: "Earlier steps" }).click();
    const steps = app.getByRole("region", { name: "Steps" });
    await expect(steps).toContainText("first line");
    expect((await steps.textContent())!.match(/line/g)).toHaveLength(5);

    // it writes a step while the person is elsewhere: back, it is there
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    const cur = await api(hubState(), "GET", `notes?id=${feed.id}`);
    await record(hubState(), "update", { id: feed.id, body: [...head, `- ${ago(0)} · said · sixth line`].join("\n"), fields: { total: 6 }, if_updated_at: cur.updatedAt });
    await page.goBack();
    await expect(steps).toContainText("sixth line");
    await expect(steps).toContainText("first line");
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
