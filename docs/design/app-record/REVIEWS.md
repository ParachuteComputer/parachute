# Reviews of the app record design

Each reviewer was a fresh Fable session that had not written or seen the design, reading it against the code.

## First review (first draft): NO-SHIP

| Objection | Where it stands |
|---|---|
| A device with no key has nothing to check a signature against; a token holder could sign with their own key. | Each device holds an anchor (the root key's public half) that the person puts there. A client without one never reads approvals. |
| What you took back could be undone by putting an older record back; order was by wall clock. | Each approval carries a number; a client keeps the newest it checked and refuses anything not higher. |
| The asks' hash differs between devices (`grantKey` takes the device's vault key and its *whose*). | Confirmed in `useApplets.ts` and `vault/store.ts`. The new hash is over the fields as written, with hub and vault name. |
| The native signer already signs kind 30078 for applets under any declared prefix. | Confirmed in `services.rs`. Approvals and key lists get kinds of their own that no applet path can produce. |
| "Built by the native side from the card on screen" can't be promised. | Dropped. The system's unlock prompt names the applet where it can; a broken shell on the approving device is treated as a stolen device. |
| The everyday key is also the Uni app's identity, so any holder could sign. | The key list gives each key a role; only approval keys approve. A separate approval key becomes required. |
| The draft guarantee was opt-in, flushed only for kept frames, promised "before hidden" over async messages, and said nothing of a full store. | `saved()` for text boxes, our applets converted in step 1, flush on background and before any unload with a 250 ms cap, a full-store rule, the promise reworded. |
| The gateway moved into an agent-writable record. | Back on the applet's signal (`via`), inside the asks' hash. The app schema refuses a gateway. |
| Signals: privacy costs unstated; "no polling" untrue on desktop; other devices' badges; approvals could be silenced. | "What it costs"; desktop said honestly; the gateway tells other phones; approval signals can't be turned off by a record or by switching app. |
| Migration: the settings schema refused the dual-write; old devices drift; removing pointers breaks old devices; "Always open with" is per device. | Schema allows the overlap; a `mirror` hash to reconcile; pointers stay through the overlap; `opens` takes `null` and the device's choice wins. |
| Schemas allowed `https://*`, an id unlike its path, a theme pointing at signed records, URLs with logins, duplicates, `../`, an end date in year 9999. | All refused, each with an example in `examples/invalid/` shown to fail for that one reason. |
| The tag `app` is too generic to guard. | `parachute-app`. |

Then Aaron's steer arrived (ADDENDUM-TRUST: a code change waits for a yes signed on a real client; one client is
enough) and layer 2 was rebuilt on it.

## Second review (after the rebuild): NO-SHIP

| Objection | Where it stands |
|---|---|
| Rollback had holes: two devices signing the same number; a device that lost its counters; a withdrawal the vault hides; `supersedes` never checked. | The number is the signing time or one more than the last, whichever is larger. A client refuses the same number with another id. `supersedes` is gone. The hidden withdrawal can't be detected by any client and is now stated as a gap. All four are in `attacks.mjs`. |
| No channel exists for the approval key's public half; today's pairing only receives the everyday key. | Confirmed in `pairing.rs`. The device now holds one anchor, put there by the person (scan or paste, with a code to compare), and the key list signed by the root key says which approval keys count. Listed as new work. |
| Recovery broke under its own rule: a re-signed `n=1` would be refused. | Fixed by the time-based number; a re-approval after a new key is in the play. |
| `attacks.mjs` was circular: constant hashes, the everyday-key case a copy of the stranger case. | Hashes are computed from code, imports and fields. The key list gives roles, so the everyday-key cases are their own. Each check was removed in turn; each removal makes at least one attempt fail. It still tests the rule, not the app, and the design says so. |
| Code outside the two hashes: the frame, embedded components; parsed values hashed. | "What the two hashes cover" added. Frame and embeds get approvals of the same kind. The asks' hash is over the fields as written. |
| An approval authenticates the yes, not the code. | Said in those words; the card says a change can misuse what the applet already has; each client keeps the last approved version for "Show what changed". |
| One record, but `modes` and `whose` are per device; the example would not run on the phone that signed it. | Modes dropped: every device runs only approved code and the card always carries the phone's warning. `whose` stays, and a device that disagrees says why. |
| Deleting approvals would stop every applet on devices that can't approve. | A client keeps what it checked; deletion stops nothing there. |
| Switching app would silence Rooms; no marker for approval signals; someone else's applet shown with a signal. | Approval signals stay registered whichever app is open, and are told apart by the service carrying `approvals`. Someone else's applets may declare only vault signals. |
| No DESIGN.md; the reactions remark missing; a placeholder left in the doc; ADDENDUM-SECURITY unaddressed. | DESIGN.md added; reactions noted under "Decided here"; reviews moved here; security levels, keys and "what opens a note" are sections now. |
| Wrong path cited for the approval-key signer; stale `Grants` in a schema pattern; small wording slips in layer 3. | Fixed. |
| Too long; decisions buried; question 3 was one the author could settle. | "Decided here, unless you say otherwise" lists them. Question 3 is now who may replace the everyday key. |

Then ADDENDUM-SECURITY arrived (security levels, key rotation through a root-signed key list, what opens a note).

## Third review (with keys and security): NO-SHIP, two blockers

| Objection | Where it stands |
|---|---|
| Recovery would re-sign whatever a thief approved: "one unlock signs it all again". | Approve again from a device the thief never held, from what that device had checked before the day the key was lost; anything later is shown apart, one at a time. |
| "Removing any one check makes the script fail" was false; 31 attempts, not 33. | `mutate.mjs` now does it for all 24 checks and prints the result: 14 caught, 10 not (format checks and second lines). The docs say those numbers. 47 attempts, counted by the script. |
| A planned rotation stopped every applet between the new list and the re-signing. | List both keys, sign again, then drop the old one. In the play. |
| A stolen key could jam an applet for good with a huge number. | Numbers from the future are refused, and what a dropped key signed orders nothing. Both in the play. |
| `subject.kind` was never checked; a component's approval passed as a frame's. | Kind is part of what an approval names. Frame and component cases are in the play. |
| The code hash dropped import names; swapping two components' contents gave the same hash. | Imports are hashed under their names. In the play. |
| Rotation was half answered: no way to make a root key, no signing step, root loss, no word that a dropped everyday key stops signing. | "Making a root key", "Signing a new list", the planned and the leaked case, and root loss are sections now. |
| Security levels were per app, the addendum says per person; routine answers unmentioned; a default stricter than today called "today's behaviour". | `security` moved to Settings; `answers` covers routine cards; the stricter default is said. |
| A hub on a port could never have an approval. | Fixed; an example and an attempt. |
| DESIGN.md left out the idle lock, what opens a note, that a root key must be made, and several decisions. | Added as items 6 and 7 and under "Decided". |
| Opening the Techne app would stop Rooms' notifications. | A device registers the signals of all your apps. |
| The #systems interface was thin; KEYRING's "second signature" unreconciled. | Three bullets on what their side must redo for a new public key; the root key signs the key list only. |
| No-root: "no list to keep" against a schema that accepts one. | The approval key, as anchor, signs the list; said so. |
| The year cap bound only honest signers; one key could hold both roles. | A start date in the future is refused; a key listed twice is refused. Both in the play. |
| Layer 3 wording; someone else's applets getting storage reverses EMBED.md unsaid; bulk signing must skip changed code. | Fixed and said. |

Not taken: "approvals name record ids while the bar names paths, so another approved record can be moved under a
bar slot". The record that opens is one you approved, under its own name; the bar shows that name.
