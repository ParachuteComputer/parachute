// Shared test data.
/** The Recipes applet's manifest as it is published today, read by the Uni app: it must parse here unchanged. */
export const RECIPES = {
  contract: 2, id: "recipes", name: "Recipes", glyph: "❀", note: "a book of recipes, each one a note in Recipes/",
  access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read", "create", "update"] }] }],
  search: [{ what: "recipes", vault: "here", path: "Recipes/" }],
  screens: [{ id: "home", name: "Recipes" }],
};
