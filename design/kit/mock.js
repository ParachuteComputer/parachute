// The same markup for both mockups: what differs is each page's tokens, part styles and ornament. Made-up content.
// ?screen=launcher | home | parts | recipes        ?theme=alt  the same screen under a second theme record
const q = new URLSearchParams(location.search);
const screen = q.get("screen") || "launcher";
if (q.get("theme") === "alt") document.documentElement.classList.add("alt");
const feel = document.documentElement.dataset.feel; // "almanac" or "garden": which drawing the activity part uses

// ── made-up content ──
const DAYS = [0, 1, 0, 2, 3, 1, 0, 0, 4, 2, 1, 0, 3, 5, 2, 0, 1, 1, 0, 2, 6, 3, 1, 0, 2, 4, 3, 5]; // 4 weeks, oldest first
const vaults = [
  { name: "kitchen", note: "recipes and what we cooked", recent: [["Lemon lentil soup", "yesterday"], ["Shopping list", "Friday"], ["Skillet cornbread", "Thursday"]], applets: [
    { g: "❀", n: "Recipes", life: "Lemon lentil soup, yesterday", d: [0, 1, 0, 2, 3, 1, 2] },
    { g: "✣", n: "Cook mode", life: "Skillet cornbread, 3 days ago", d: [1, 0, 0, 1, 0, 0, 1] },
    { g: "◠", n: "Home", life: "opens on start", d: [2, 1, 3, 2, 4, 3, 5], home: true },
  ] },
  { name: "garden", note: "the beds, the seeds, the weather", recent: [["Sweet peas sown", "today"], ["Bed three, compost", "yesterday"], ["Rain, 4 mm", "yesterday"]], applets: [
    { g: "✿", n: "Seed log", life: "Sweet peas sown, today", d: [0, 0, 1, 0, 2, 1, 3] },
    { g: "≈", n: "Rain gauge", life: "4 mm overnight", d: [1, 1, 1, 1, 1, 1, 1] },
  ] },
];
const recipes = [
  { t: "Lemon lentil soup", m: "soup · weeknight", a: "yesterday" },
  { t: "Skillet cornbread", m: "bread", a: "3 days ago" },
  { t: "Green herb rice", m: "side · weeknight", a: "3 Nov" },
  { t: "Tomato toast", m: "breakfast", a: "28 Oct" },
  { t: "Rice and beans", m: "weeknight", a: "20 Oct" },
];
const lately = [
  { day: "Today", notes: [{ t: "Sweet peas sown", v: "garden", at: "9:40" }, { t: "Lemon lentil soup", v: "kitchen", at: "8:15" }] },
  { day: "Yesterday", notes: [{ t: "Bed three, compost", v: "garden", at: "17:02" }, { t: "Skillet cornbread", v: "kitchen", at: "12:30" }, { t: "Rain, 4 mm", v: "garden", at: "07:00" }] },
  { day: "Friday", notes: [{ t: "Shopping list", v: "kitchen", at: "18:20" }] },
];

// ── ornament: inline SVG only (a sealed frame loads nothing) ──
const sprig = `<svg class="orn-sprig" viewBox="0 0 120 40" aria-hidden="true"><path d="M4 30 C30 26 60 18 116 8" fill="none" stroke="currentColor" stroke-width="1.4"/>${[18, 34, 50, 66, 82, 98].map((x, i) => { const y = 29 - x * 0.19; return `<path d="M${x} ${y} q${i % 2 ? 6 : -2} ${i % 2 ? 9 : -10} ${12} ${i % 2 ? 4 : -6}" fill="none" stroke="currentColor" stroke-width="1.1"/><ellipse cx="${x + 9}" cy="${y + (i % 2 ? 6 : -7)}" rx="4.5" ry="2" transform="rotate(${i % 2 ? 30 : -30} ${x + 9} ${y + (i % 2 ? 6 : -7)})" fill="currentColor" opacity=".55"/>`; }).join("")}</svg>`;
const rule = `<div class="orn-rule" aria-hidden="true"><span></span><i>❦</i><span></span></div>`;
const hills = `<svg class="orn-hills" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120 C180 60 320 70 480 100 S820 40 1200 90 V160 H0Z" class="h1"/><path d="M0 140 C220 100 400 120 620 128 S960 96 1200 120 V160 H0Z" class="h2"/><path d="M0 150 C300 136 640 150 1200 140 V160 H0Z" class="h3"/></svg>`;

// ── the activity part: what changed, a day at a time ──
function activity(days, label) {
  const max = Math.max(...days, 1);
  if (feel === "garden") {
    // a bloom: one petal per day of the last four weeks, longer where more changed
    const n = days.length, petals = days.map((v, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2, r = 10 + (v / max) * 34;
      const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
      return `<line x1="${50 + Math.cos(a) * 8}" y1="${50 + Math.sin(a) * 8}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.5 + v / max * 2.5).toFixed(1)}"/>`;
    }).join("");
    return `<figure class="pa-days" aria-label="${label}"><svg viewBox="0 0 100 100">${petals}<circle cx="50" cy="50" r="6" class="core"/></svg><figcaption>${label}</figcaption></figure>`;
  }
  // an almanac's tally: a column of ink marks per day, weeks set apart, today ringed
  const cols = days.map((v, i) => `<g transform="translate(${i * 9 + Math.floor(i / 7) * 6} 0)">${Array.from({ length: v }, (_, k) => `<rect x="0" y="${34 - k * 5}" width="6" height="3.4" rx="1"/>`).join("")}<rect x="0" y="40" width="6" height="1" class="base"/>${i === days.length - 1 ? `<circle cx="3" cy="46" r="1.6" class="today"/>` : ""}</g>`).join("");
  return `<figure class="pa-days" aria-label="${label}"><svg viewBox="0 0 ${days.length * 9 + 24} 50">${cols}</svg><figcaption>${label}</figcaption></figure>`;
}
const spark = (d) => `<svg class="spark" viewBox="0 0 60 16" aria-hidden="true"><polyline points="${d.map((v, i) => `${i * 10},${14 - v * 2.4}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="60" cy="${14 - d[6] * 2.4}" r="2"/></svg>`;

// ── the parts ──
const note = `
  <h1>Lemon lentil soup</h1>
  <p class="pa-lede">Soft red lentils, a lot of lemon. Better the next day.</p>
  <dl class="pa-facts"><div><dt>Serves</dt><dd>4</dd></div><div><dt>Time</dt><dd>35 min</dd></div><div><dt>Made</dt><dd>twice</dd></div></dl>
  <h2>Ingredients</h2>
  <ul><li>1 cup red lentils, rinsed</li><li>1 onion, chopped</li><li>2 cloves garlic</li><li>1 tsp cumin</li><li>5 cups stock</li><li>1 lemon</li></ul>
  <h2>Steps</h2>
  <ol><li>Soften the onion in a little oil, about 8 minutes.</li><li>Add the garlic and cumin for a minute.</li><li>Add lentils and stock; simmer 20 minutes.</li><li>Squeeze in the lemon. Good with <a href="#">Green herb rice</a>.</li></ol>
  <blockquote>Halve the cumin for small people.</blockquote>`;
const list = (label, items) => `
  <section class="pa-list" aria-label="${label}"><h3 class="pa-list-label">${label}</h3><ul>
  ${items.map((r) => `<li><button class="pa-row"><span class="pa-row-title">${r.t}</span><span class="pa-row-meta">${r.m}</span><span class="pa-row-aside">${r.a}</span></button></li>`).join("")}
  </ul></section>`;
const card = (title, body) => `<section class="pa-card"><h3 class="pa-card-title">${title}</h3>${body}</section>`;
const field = (label, value, action) => `<label class="pa-field"><span class="pa-field-label">${label}</span><span class="pa-field-row"><input value="${value}" placeholder="A name">${action ? `<button class="pa-field-action">${action}</button>` : ""}</span></label>`;
const empty = (line) => `<div class="pa-empty">${sprig}<p>${line}</p></div>`;

// ── the shell around an applet, and the bar ──
const shellTop = (glyph, title) => `<header class="shell-top"><span class="back">‹</span><span class="glyph">${glyph}</span><b>${title}</b><span class="more">···</span></header>`;
const shellBar = (on) => `<nav class="shell-bar">${[["⁂", "Launcher"], ["◠", "Home"], ["❀", "Recipes"], ["✿", "Seed log"]].map(([g, n]) => `<a class="${n === on ? "on" : ""}"><span class="g">${g}</span>${n}</a>`).join("")}</nav>`;

const today = "Monday, 16 November";
let body;
if (screen === "launcher") {
  body = `<main class="page launcher">
    <header class="mast">${hills}<div class="mast-words"><h1>Parachute</h1><p class="mast-when">${today}</p><p class="mast-sum">Fourteen notes changed this week, most of them in the garden.</p></div>${activity(DAYS, "the last four weeks")}</header>
    <div class="chapters">
    ${vaults.map((v, vi) => `<section class="chapter"><h2><span class="chap-num">${["I", "II"][vi]}</span><span class="chap-name">${v.name}</span><a>Open the vault</a><span class="chap-note">${v.note}</span></h2>
      <ol class="entries">${v.applets.map((a) => `<li class="entry"><span class="medal">${a.g}\uFE0E</span><span class="entry-name">${a.n}${a.home ? ` <em class="tag">home</em>` : ""}</span><span class="entry-life">${a.life}</span>${spark(a.d)}</li>`).join("")}</ol>
      <h3 class="lately-label">Lately in ${v.name}</h3><ul class="lately">${v.recent.map(([t, when]) => `<li><span>${t}</span><i>${when}</i></li>`).join("")}</ul></section>`).join(rule)}
    </div>
    <p class="foot"><a>Add a vault</a> <a>Settings</a></p>
  </main>${shellBar("Launcher")}`;
} else if (screen === "home") {
  body = `${shellTop("◠", "Home")}<main class="page home">
    <header class="home-head"><div><p class="kick">${today}</p><h1>Good morning.</h1><p class="home-sum"><span class="drop">S</span>weet peas went in today, and the soup from Sunday is written down. Two vaults, six notes since Friday.</p></div>${activity(DAYS.slice(-14), "the last two weeks")}</header>
    <div class="home-cols"><section class="river">${lately.map((d) => `<h2>${d.day}</h2>${d.notes.map((n) => `<button class="pa-row"><span class="pa-row-title">${n.t}</span><span class="pa-row-meta">${n.v}</span><span class="pa-row-aside">${n.at}</span></button>`).join("")}`).join("")}</section>
    <aside class="pins"><h2>Pinned</h2>${vaults.flatMap((v) => v.applets.filter((a) => !a.home)).slice(0, 3).map((a) => `<button class="pin"><span class="medal">${a.g}\uFE0E</span>${a.n}<span class="pin-life">${a.life}</span></button>`).join("")}${sprig}</aside></div>
  </main>${shellBar("Home")}`;
} else if (screen === "parts") {
  body = `${shellTop("◇", "The parts")}<main class="page sheet">
    <div class="col"><p class="kicker">Note</p><article class="pa-note">${note}</article></div>
    <div class="col"><p class="kicker">Days</p>${activity(DAYS, "the last four weeks")}
      <p class="kicker">List</p>${list("This week", recipes.slice(0, 3))}
      <p class="kicker">Card</p>${card("Made twice", `<p>Last on 2 November. Halve the cumin for small people.</p>`)}
      <p class="kicker">Field</p>${field("New recipe", "Barley stew", "Add")}
      <p class="kicker">Empty</p>${empty("No recipes yet. Add one above, or ask your AI to.")}</div>
  </main>${shellBar("Launcher")}`;
} else {
  body = `${shellTop("❀", "Recipes")}<main class="page sheet two">
    <div class="col"><header class="rec-head"><h1>Recipes</h1><p>Five recipes, two made this month.</p></header>${activity(DAYS, "cooked, the last four weeks")}
      ${field("New recipe", "", "Add")}${list("Lately", recipes.slice(0, 2))}${list("Earlier", recipes.slice(2))}</div>
    <div class="col wide-only"><article class="pa-note">${note}</article></div>
  </main>${shellBar("Recipes")}`;
}
document.body.innerHTML = body;
