import { describe, expect, it } from "vitest";
import { roleTagsFrom } from "./roles";

describe("roleTagsFrom", () => {
  it("is the defaults with no settings note", () => expect(roleTagsFrom(null)).toEqual(["pinned", "archived", "capture", "view"]));
  it("reads the older lens key too", () => expect(roleTagsFrom({ lens: { tagRoles: { pinned: "star" } } })).toContain("star"));
  it("adds the tags the vault's settings give a role to", () => expect(roleTagsFrom({ notes: { tagRoles: { pinned: "#favourite", view: "view", captureText: " inbox " } } })).toEqual(["pinned", "archived", "capture", "view", "favourite", "inbox"]));
});
