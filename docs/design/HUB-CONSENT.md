# Proposal for parachute-core: the hub's consent page in plain rows

For the hub's own page (`packages/hub/src/oauth-ui.ts`, `renderConsent`), which a person sees when the Parachute app
asks for a vault (docs/design/SCOPES.md): the same shape as the app's card (PERMISSIONS.md, "How it looks"), after
Aaron's note of 11-19 with Techne's Authorize page as the example ("not copy exactly… an example of what a more
elegant solution might look and feel like"). A proposal for a core PR; nothing in core is changed here.

## Today (read from the code, not rendered)

Heading *Approve «client»?*, a line that the app asks for access to your account, a trust badge (*First-party* /
*External*), the `client_id`, then **Permissions requested** with one checkbox per scope worded by
`SCOPE_EXPLANATIONS` (`vault:journal:write` reads as the generic `vault:write` sentence), and **Approve** / **Deny**.
Inline CSS, no JavaScript.

## Proposed

1. **Who is asking, first.** "Parachute (the app on this hub)" for a first-party client; for an external one a tinted
   line: *Not made by this hub. Only continue if you trust the people who made it.* No tint for first-party.
2. **One row per scope**: a mark, a plain name (*Read your journal*, *Write in playground*, *See which vaults you
   have*), one short line, and a **?** that opens the exact detail with `<details>`/`<summary>` (no script): the scope
   string (`vault:journal:write`), for a vault a table of Read / Create / Update / Delete with ticks, and *Towards:
   journal on uni.example*. The per-vault name goes into the row's name, not only the generic sentence.
3. **Three buttons**: Back (to where the app sent the person from: `redirect_uri` with `error=access_denied` is Deny;
   Back is the browser's history), **Deny**, **Approve** (the strong one).
4. **The look**: a serif heading, warm off-white (`PALETTE`), calm sizes; the same palette the app's theme has.
5. **Keep**: the checkboxes for optional extra scopes, the disabled Approve for a zero-vault account, the unknown-client
   page.

## Tests to change or add (core)

`packages/hub/src/__tests__/oauth-ui.test.ts`: rows per scope with the vault name, the `?` detail holding the exact
scope string, the warning only for external clients, three buttons. `account-scope-consent.test.ts` stays.

Owner: core (#systems or whoever holds parachute-core). Not started.
