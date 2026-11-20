// A form written the plain way works in an applet (the cold walk, T-476: an AI's reading tracker used <form onSubmit>
// and a submit button, and its Add did nothing). A sealed frame has no allow-forms, so the browser drops the submit;
// the kit sends it (src/applet/kits/frameKit.ts). The button, Enter in a field, and a disabled button that stays put.
import { expect, test } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const CODE = `import { useState } from "react";
import { Button, Page } from "parachute";
export default function Form() {
  const [said, setSaid] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  return <Page title="Form test">
    <form onSubmit={(e) => { e.preventDefault(); setSaid((s) => [...s, text]); setText(""); }}>
      <input aria-label="Title" value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" disabled={!text.trim()}>Add</Button>
    </form>
    <form onSubmit={(e) => { e.preventDefault(); setSaid((s) => [...s, "tag:" + tag]); }}>
      <input aria-label="Tag" required value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag === "hold") e.preventDefault(); }} />
      <Button type="submit">Tag</Button>
    </form>
    <ul aria-label="Added">{said.map((s, i) => <li key={i}>{s}</li>)}</ul>
  </Page>;
}
`;

test("a form's submit button and Enter in its field reach onSubmit; a disabled button, an empty required field and the applet's own preventDefault don't", async ({ page }) => {
  const note = await api(hubState(), "POST", "notes", { path: "Applets/Form test", extension: "tsx", tags: ["applet"], content: CODE,
    metadata: { applet: { contract: 2, id: "form-test", name: "Form test", glyph: "▤" } } });
  try {
    await page.goto(`/v/${VAULT}/a/${note.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator("iframe.applet-frame");
    const added = f.getByRole("list", { name: "Added" });
    await f.getByLabel("Title").fill("The Overstory");
    await f.getByRole("button", { name: "Add" }).click();
    await expect(added.getByRole("listitem")).toHaveText(["The Overstory"]);
    await f.getByLabel("Title").fill("Braiding Sweetgrass");
    await f.getByLabel("Title").press("Enter");
    await expect(added.getByRole("listitem")).toHaveText(["The Overstory", "Braiding Sweetgrass"]);
    // empty: the button is disabled, and Enter does nothing either
    await f.getByLabel("Title").press("Enter");
    await expect(added.getByRole("listitem")).toHaveCount(2);
    // as a browser does: a required field left empty doesn't submit, and the applet's own preventDefault on Enter holds
    await f.getByRole("button", { name: "Tag" }).click();
    await f.getByLabel("Tag").fill("hold");
    await f.getByLabel("Tag").press("Enter");
    await expect(added.getByRole("listitem")).toHaveCount(2);
    await f.getByLabel("Tag").fill("garden");
    await f.getByLabel("Tag").press("Enter");
    await expect(added.getByRole("listitem")).toHaveText(["The Overstory", "Braiding Sweetgrass", "tag:garden"]);
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`).catch(() => {}); }
});
