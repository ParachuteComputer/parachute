// The same markup for both mockups: what differs is only each page's tokens and part styles. Made-up content.
// ?screen=parts  the five parts on one sheet          ?screen=recipes  the Recipes applet built from them
// ?theme=alt     the same screen under a second theme record (to show that a theme note restyles everything)
const q = new URLSearchParams(location.search);
const screen = q.get("screen") || "parts";
if (q.get("theme") === "alt") document.documentElement.classList.add("alt");

const recipes = [
  { t: "Lemon lentil soup", m: "soup · weeknight", a: "2 days ago" },
  { t: "Skillet cornbread", m: "bread", a: "last week" },
  { t: "Green herb rice", m: "side · weeknight", a: "3 Nov" },
  { t: "Tomato toast", m: "breakfast", a: "28 Oct" },
  { t: "Rice and beans", m: "weeknight", a: "20 Oct" },
];
const note = `
  <h1>Lemon lentil soup</h1>
  <p class="pa-lede">Soft red lentils, a lot of lemon. Better the next day.</p>
  <h2>Ingredients</h2>
  <ul><li>1 cup red lentils, rinsed</li><li>1 onion, chopped</li><li>2 cloves garlic</li><li>1 tsp cumin</li><li>5 cups stock</li><li>1 lemon</li></ul>
  <h2>Steps</h2>
  <ol><li>Soften the onion in a little oil, about 8 minutes.</li><li>Add the garlic and cumin for a minute.</li><li>Add lentils and stock; simmer 20 minutes.</li><li>Squeeze in the lemon. See <a href="#">Green herb rice</a> to go with it.</li></ol>
  <blockquote>Made twice. Halve the cumin for small people.</blockquote>`;

const list = (label, items) => `
  <section class="pa-list" aria-label="${label}"><h3 class="pa-list-label">${label}</h3><ul>
  ${items.map((r) => `<li><button class="pa-row"><span class="pa-row-title">${r.t}</span><span class="pa-row-meta">${r.m}</span><span class="pa-row-aside">${r.a}</span></button></li>`).join("")}
  </ul></section>`;
const card = (title, body) => `<section class="pa-card"><h3 class="pa-card-title">${title}</h3>${body}</section>`;
const field = (label, value, action) => `<label class="pa-field"><span class="pa-field-label">${label}</span><span class="pa-field-row"><input value="${value}" placeholder="A name">${action ? `<button class="pa-field-action">${action}</button>` : ""}</span></label>`;
const empty = (line) => `<div class="pa-empty"><span class="pa-empty-mark" aria-hidden="true"></span><p>${line}</p></div>`;

const shellTop = (glyph, title) => `<header class="shell-top"><span class="back">‹</span><span class="glyph">${glyph}</span><b>${title}</b><span class="more">···</span></header>`;
const shellBar = (on) => `<nav class="shell-bar">${["⁂ Launcher", "◠ Home", "❀ Recipes"].map((x) => `<a class="${x.includes(on) ? "on" : ""}"><span>${x.split(" ")[0]}</span>${x.split(" ")[1]}</a>`).join("")}</nav>`;

let body;
if (screen === "parts") {
  body = `${shellTop("◇", "The parts")}
  <main class="sheet">
    <div class="col">
      <p class="kicker">Note</p>
      <article class="pa-note">${note}</article>
    </div>
    <div class="col">
      <p class="kicker">List</p>
      ${list("This week", recipes.slice(0, 3))}
      <p class="kicker">Card</p>
      ${card("Made twice", `<p>Last on 2 November. Halve the cumin for small people.</p>`)}
      <p class="kicker">Field</p>
      ${field("New recipe", "Barley stew", "Add")}
      <p class="kicker">Empty</p>
      ${empty("No recipes yet. Add one above, or ask your AI to.")}
    </div>
  </main>${shellBar("Launcher")}`;
} else {
  body = `${shellTop("❀", "Recipes")}
  <main class="sheet two">
    <div class="col">
      <h1 class="page-title">Recipes</h1>
      <p class="page-sub">Five recipes, two this month.</p>
      ${field("New recipe", "", "Add")}
      ${list("Lately", recipes.slice(0, 2))}
      ${list("Earlier", recipes.slice(2))}
    </div>
    <div class="col wide-only">
      <article class="pa-note">${note}</article>
    </div>
  </main>${shellBar("Recipes")}`;
}
document.body.innerHTML = body;
