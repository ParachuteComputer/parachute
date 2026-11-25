# Getting Parachute to testers: Google Play and Apple

Plan as of 2026-11-23. The short of it:

- **Android:** Google Play **internal testing** first (up to 100 testers by email, no review), then **closed testing**.
  The APK from aero stays, for GrapheneOS without Google and for anyone who'd rather not use Play.
- **Mac:** the dmg we already make, **signed with a Developer ID certificate and notarised**, so it opens with no
  Gatekeeper steps. No Mac App Store or TestFlight for now (why below).
- **iPhone:** **TestFlight**, built and uploaded by `.github/workflows/ios.yml` (most testers use iPhones; Aaron,
  11-24). Waiting on Aaron's three steps: the signing files, the App Store Connect record, the encryption answer
  ([iPhone](#iphone)).
- Built and waiting: the Play bundle (`scripts/android-build.sh --play`, `.github/workflows/play.yml`), the Mac signing
  and notarisation (`.github/workflows/mac.yml`, `scripts/mac-notarise-dmg.sh`), the privacy policy
  ([PRIVACY.md](PRIVACY.md)), the listing and screenshots (`store/`).
- Missing: Aaron's console steps (FOR-AARON) and three secrets, which Uni asks for through a sealed secret card.
- Read from outside once (Gemini Neon, 11-23); what it caught is folded in below.

## Google Play

### The tracks

| Track | Who | Review | Needs |
|---|---|---|---|
| Internal testing | up to 100 people, by email list | none | the app created, a bundle uploaded |
| Closed testing | lists or a Google Group, any size | yes, first release and changes | every App content form, the store listing |
| Open testing, production | anyone | yes | production access |

A **personal** Play account made after 13 Nov 2023 gets production access only after a closed test with at least 12
testers opted in for the 14 days before applying (invite about 20, so drop-outs don't restart the count). Internal
testing doesn't count toward it. An organisation account (D-U-N-S number) doesn't have this rule.

### What the Play build is

- **Package id `computer.parachute.app`.** Not on Play yet (its store page answered 404 on 11-23). The first uploaded
  bundle fixes it for good. Keep it: every installed build, the Mac Keychain item and the app's data
  folders already use it. (Tauri warns that a Mac bundle id ending in `.app` looks like an app bundle; the only effect
  is that Finder shows the data folder `~/Library/Application Support/computer.parachute.app` as an app. Changing the
  id would cost every install its key and data.)
- **An app bundle (.aab)**, arm64 like the APK: `scripts/android-build.sh --play`. CI builds it on pull requests that
  touch the Android build and on each release tag (artifact `play-bundle`). Nothing uploads it yet.
- **No in-app update.** `PARACHUTE_STORE=play` merges `src-tauri/gen/android/app/src/play/AndroidManifest.xml`, which
  removes `REQUEST_INSTALL_PACKAGES` (Play refuses it in an app whose purpose isn't installing apps, and its policy
  allows updates only through Play), and `src-tauri/build.rs` refuses an update feed in it. Without a feed the app shows
  only its own build under Settings → Updates. The build script checks the bundle's manifest and fails if the
  permission is back. The Android TV launcher entry is gone from both builds (Play would list the app as a TV app).
- **Target SDK 36**: what Play requires of new apps and updates since 31 Aug 2026.
- **Version code**: the number of commits behind the built commit (`scripts/play-version-code.sh`, 513 on 11-24, 514 with this change).
  Two builds of one commit agree, each commit on `next` counts one more, and
  squash merges never take a commit away, so it only rises. It stays small: Play's ceiling is 2,100,000,000 and a used
  code can never go back down, so the first try, the commit's unix time (about 1.8 billion now, the ceiling in 2036),
  was refused by Play ("significantly higher than your previous version code"). Two guards: a shallow clone is
  refused (its count would be too low; `play.yml` fetches the whole history), and so is a commit that isn't on
  `origin/next` (a feature branch counts commits a squash merge drops, so its code could outrun the builds of `next`
  after it). Pull-request builds, signed with a throwaway key and never uploaded, skip the second. A tag on `main` is
  behind `next` and counts lower: upload only the newest build. Play takes each code once, so uploading again needs a new
  commit. The APK for sideloading (a different signer, never an update of a Play install) keeps the commit's time as
  its code. The first bundle, with code 1795514721, stays unpublished in the Play library and is replaced.
- **16 KB memory pages**: every native library is aligned for them (Play requires it for Android 15 targets); the build
  script checks each one.
- **Signing: Play App Signing with Google's key** (the default; Google now makes a quantum-ready hybrid key). We keep
  only an **upload key**, new for Play: Uni makes it on aero, keeps it at `~/.config/parachute-play-upload/`, and sets
  the four repository secrets `PLAY_UPLOAD_KEYSTORE_BASE64`, `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS`,
  `PLAY_UPLOAD_KEY_PASSWORD` (the same shape as the play-test key's; no backslash in the passwords). Pull requests never
  get them: they build with a throwaway key. A lost upload key can be reset by Google.

  The cost: a Play install and an APK from aero have different signers, so one can't update the other. Moving between
  them is a reinstall (the key comes back by pairing). The other way, giving Play a copy of the play-test key, keeps
  one signature everywhere, but adds steps, gives up Google's hybrid key, and hands Google the key that signs the
  builds people take outside Play. Recommended: Google's key. Decide before the first upload: Google's page allows a
  change until the first open or production release, but internal testers would have to reinstall.
- **Sideloaded APKs and Android's developer verification** (enforced worldwide in 2027 on Google-certified phones;
  GrapheneOS doesn't enforce it). Creating the app in Play Console registers the package and the Play signing key. The
  play-test key that signs the aero APK must be added too: Play Console → Android developer verification → the
  package → add its SHA-256 fingerprint. Uni has the fingerprint (`scripts/android-build.sh` prints its start).

### App content (Play Console → Policy → App content)

None of this is needed for internal testing; all of it before closed testing.

- **Privacy policy URL:** https://parachute.computer/privacy/, which Settings → Privacy opens in the app too. That page
  covers Parachute Cloud today; the app's part ([PRIVACY.md](PRIVACY.md)) has to be added there before closed testing
  (a site change, with Aaron's go-ahead). For internal testing the GitHub page of PRIVACY.md will do.
- **Ads:** no ads. **Advertising ID:** not used (the app doesn't ask for it). **News app:** no.
- **App access:** reviewers need a sign-in that always works without an emailed code. Parachute Cloud's sign-in is an
  emailed code, so the answer is a reviewer account on a hub with a password, and the steps (first screen → Your notes
  on another Parachute → its address → Other ways to sign in). **Not set up yet** (Uni).
- **Content rating (IARC):** category "all other app types"; no violence, sexual content, bad language, drugs,
  gambling or purchases; users **can** interact (rooms); no location shared. Expect Everyone or Teen, with "Users
  Interact".
- **Target audience:** 18 and over.
- **User-generated content:** rooms let people send each other messages, and Play asks such apps for a way to report
  content and block a person, and for rules on what is allowed. The app has neither yet. Needed before closed testing
  review; the rooms applet is where it goes.
- **Data safety:** the answers are in the next section.
- **Foreground service:** the app declares `remoteMessaging` for its fallback relay listener (NotifyService.kt), so Play
  asks for a description and a link to a short video of a person turning on notifications while the app is closed.
  Google reads `remoteMessaging` narrowly (passing messages between a person's devices). If review refuses it, the plain
  way out is to leave the listener out of the Play build (one more line in its manifest, and a guard where the app
  starts it): people on Play then get notifications while closed through a UnifiedPush app such as ntfy. Description:
  "Keeps one connection to the person's own message relay so that messages that name them arrive while the app is
  closed, on phones without a push distributor. The person turns it on or off in Settings; it shows a lasting
  notification while it runs." The video: **not made yet** (Uni, on the emulator).
- **Account deletion:** the first screen offers **Sign in with Parachute Cloud**, which makes an account for a new
  email, so Play requires deletion from inside the app and on the web. Web: https://parachute.computer/privacy/
  ("Deleting your data": email hello@parachute.computer; Cloud deletes the account and its vaults); Play prefers a page
  of its own that names the app and says what is deleted and what is kept. In the app: **not built yet**. Parachute
  Cloud already has the door (`POST /account/delete`, `account_delete` in its account descriptor); the app needs a
  Settings line for a Cloud sign-in that uses it, or links to a Cloud page that does.
- **Government, financial, health features:** none.
- **Countries:** choose them on the closed testing track (internal testing needs none).

### Data safety answers

Play counts as "collected" anything the app sends off the phone, to us or to anyone else, even a server the person runs.
So the honest answer lists what the app sends to the person's own Parachute, relays and push service. (Nextcloud
answers "No data collected" for the same situation; we don't, because Parachute Cloud, which we run, is one of the
places it goes.)

- Does the app collect or share any of the required user data types? **Yes.**
- Is all of it encrypted in transit? **Yes** (https and wss only; plain http only to the phone itself).
- Can people ask for their data to be deleted? **Yes.**
- Shared with third parties: **none** (what goes to a Parachute or relay the person chose is their own action).

| Data type | Collected | Why | Optional |
|---|---|---|---|
| Personal info: email address | yes, Parachute Cloud sign-in only | Account management | yes |
| Personal info: user IDs | yes, the public key | App functionality, Account management | no |
| Messages: other in-app messages | yes, rooms | App functionality | yes |
| Photos and videos: photos | yes, pictures added to notes | App functionality | yes |
| Audio: voice or sound recordings | yes, voice notes | App functionality | yes |
| Files and docs | yes, files added to a vault | App functionality | yes |
| App activity: other user-generated content | yes, notes, journal, people | App functionality | no |
| Device or other IDs | yes, the push address, only with notifications while closed | App functionality | yes |

Not collected: location, contacts (the phone's), calendar, health, financial info, web browsing, app interactions,
search history, installed apps, crash logs, diagnostics. The app has no analytics, ads or crash reporting (checked in
the code on 11-23: no such libraries or calls).

### Store listing

Text: [store/listing.md](../store/listing.md). Graphics: `store/play/`: the icon (512×512), the feature graphic
(1024×500) and phone screenshots (1080×1920) from the Play build on an emulator, with made-up notes and people.
Category Productivity; contact hello@parachute.computer; website https://parachute.computer.

## Apple

### Recommendation: Developer ID and notarisation now; the App Store later

A notarised dmg opens after one ordinary "downloaded from the internet" question, keeps one signature across updates
(so the Keychain stops asking after each one), costs nothing beyond the membership and needs no review. It keeps
today's downloads and update feed.

**TestFlight for Mac and the Mac App Store** need the App Sandbox, and that costs more than it gives now:

- entitlements for outgoing connections, for the loopback port the sign-in returns to (`network.server`, even on
  127.0.0.1), the microphone and files the person picks; files picked once can't be reopened after a restart (Tauri
  has no security-scoped bookmarks yet, #3716);
- a provisioning profile, an Apple Distribution and a Mac Installer Distribution certificate, an App Store Connect
  record, and a signed .pkg upload;
- no self-updater (the feed is off there), App Review before external testers, builds that expire after 90 days, and
  testers on macOS 13 or newer;
- open Tauri bugs on exactly this path: App Store signing (#15230), network requests blocked under the sandbox
  (#13878).

Revisit it now that the iPhone app is on TestFlight ([iPhone](#iphone)): one TestFlight could serve both.

### What Apple needs for the dmg

- **A Developer ID Application certificate** (choose the G2 Sub-CA). Only the Account Holder can make one, on the
  developer website or in Xcode; the API can't. Exported from the Mac's Keychain as a .p12 with a password.
- **The hardened runtime:** on (Tauri's default). Entitlements: only `com.apple.security.device.audio-input`
  (`src-tauri/Entitlements.plist`). The key lives in the login Keychain as a plain password item, which needs no
  entitlement or provisioning profile.
- **Bundle id `computer.parachute.app`:** no App ID registration is needed for Developer ID. Registering it as an
  explicit App ID keeps it ready for a later App Store or iPhone app.
- **Notarisation:** `notarytool` with an App Store Connect API **Team** key, role **Developer**. The Account Holder
  first requests API access (Users and Access → Integrations). The .p8 file downloads once.
- **Stapling:** Tauri notarises and staples the app; `scripts/mac-notarise-dmg.sh` notarises and staples the dmg, then
  checks both with `spctl` as a download.
- **CI:** `mac.yml` signs and notarises a build of `next`, a release or a run by hand when all five secrets are set:
  `APPLE_CERTIFICATE` (the .p12, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY` (key id), `APPLE_API_ISSUER`,
  `APPLE_API_KEY_P8` (the .p8's text). None set, and on every pull request: ad-hoc as now. Some set: the run fails.

After the first notarised build, the Mac asks once more about the Keychain item (the signature changed from ad-hoc),
then not again. The certificate needs renewing before it expires (check the date on the first one: Apple's page says
one year for G2 certificates, other sources five); renewing means a new .p12 in the same secret. notarytool also stops
working whenever Apple has a new agreement the Account Holder hasn't accepted.

## iPhone

### What the iPhone build is

- **The same app**, from `src-tauri/gen/apple` (made once by `tauri ios init` on a Mac runner and kept; CI fails if a
  build would change it). Bundle id `computer.parachute.app`, team FLX9G758VB, iOS 16 or newer, iPhone and iPad.
- **What differs from Android and the Mac:**
  - The key in the iPhone's Keychain (the keyring crate's iOS store). The device unlock before an approval is Face ID
    or the passcode (LocalAuthentication, as on the Mac); with no passcode set it says so.
  - The webview's seal closes the bridge to native code, as on the Mac, but leaves WebRTC on: switching it off takes a
    private WebKit call an App Store build must not make. So the self-test runs approved code only there, as on Android.
  - **No in-app update and no feed**: TestFlight and the App Store update it, and their rules allow no other way.
    `build.rs` refuses `PARACHUTE_UPDATE_FEED` for an iPhone build.
  - **Saved files** go to the app's Documents, which Files shows as On My iPhone → Parachute (an iPhone has no
    Downloads an app may write to).
  - **Pairing** can scan the other device's QR code, as on Android.
  - **An iPad** asks for desktop pages, so its user agent says "Macintosh"; a Macintosh with touch points is named an
    iPad (`src/shell/agent.ts`), on the approvals it signs, on Parachute Cloud's pages and in the self-test.
  - `parachute://` links open the app (the deep-link plugin writes the scheme into the Info.plist). No other scheme is
    registered, on any platform.
  - The Info.plist lines iOS shows when it first asks: microphone, camera, Face ID (`src-tauri/Info.ios.plist`).
- **Not on the iPhone yet:** the words for saving a file still say Downloads (an applet's card and its face: the face is
  part of a signed approval, so changing it per device needs care); notifications while the app is closed (Android's relay listener can't run there; it needs
  Apple push and a push key), a recording that goes on while another app is in front (background audio), and saving to
  a folder the person picks (a document picker).
- **Build number** (CFBundleVersion): the commit count alone, as Play's version code (`scripts/play-version-code.sh`),
  beside the version 0.1.0. Not Tauri's `--build-number`, which makes 0.1.0.<count>: Apple reads at most three parts,
  so every build would read as 0.1.0. Build from `next`: a feature branch's count could outrun later builds of `next`,
  and TestFlight takes each number once. `ios.yml` checks the number inside the .ipa.

### CI

`ios.yml` on each pull request except docs-only ones (as `mac.yml`), on `testflight-*` and release tags, and by hand:

- **simulator** (every run): a debug build for the simulator, installed on a fresh simulator and driven with XCUITest
  (`scripts/ios-drive.sh`, `scripts/ios-drive/`): paste a key, sign in to a throwaway hub through its Approve page, see the
  applets, open Rooms, allow it with Face ID (enrolled on the simulator, and matched), see a room on a fake relay
  (`e2e/ios/world.ts`). Screenshots are the artifact `ios-drive`.
- **testflight** (after the simulator job passes; a `testflight-*` tag on a commit of `next`, a release tag, or by hand once `ios.yml` is on `main`:
  GitHub dispatches only the default branch's workflows; never a pull request): signed for the App Store and uploaded with `altool`, when all
  three iPhone secrets are set: `IOS_CERTIFICATE` (the Apple Distribution certificate with its key, a .p12, base64),
  `IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION` (the App Store profile, base64). The upload uses the App Store
  Connect key the Mac workflow uses. None set: it says so and passes. Some set: it fails.

### Signing, and who may do what

The App Store Connect key we hold has the **Developer** role. Tried on 11-24: it reads bundle ids, certificates,
profiles, apps and TestFlight groups, but registering the bundle id and making the certificate are refused (403).
Only an Admin key or the Account Holder may make identifiers, certificates and profiles; only they make the app record
(the API can't).

`scripts/ios-signing.mjs` does each step that isn't done yet: registers the bundle id, makes an **Apple Distribution**
certificate from the CSR of a private key kept on uni (`~/.config/uni/apple-ios/`, never in the repository), makes the
**App Store** profile ("Parachute App Store <date>"; this app's older App Store profiles go only once the new one is
made), writes the .p12, and with `--secrets` sets the three repository secrets from
those files. With `--group`, once the app record exists, it makes the internal TestFlight group "Parachute testers"
(every build). With the Developer key it stops at the first step it may not take; if Aaron made the files by hand, it
reads them and goes on.

### Aaron's steps

1. The signing files: a temporary **Admin** team key for Uni (App Store Connect → Users and Access → Integrations →
   Team Keys → +, Access Admin), revoked after; or the bundle id, certificate and profile by hand at
   developer.apple.com.
2. The app record: App Store Connect → Apps → + → New App, iOS, name **Parachute: your own vault** (the Play listing's;
   plain "Parachute" is another company's app), bundle id `computer.parachute.app`, SKU `parachute-ios`.
3. The export compliance answer on the first build (the app uses standard algorithms of its own: rustls, secp256k1,
   ChaCha20). Once he answers, `ITSAppUsesNonExemptEncryption` goes into `Info.ios.plist` so later builds don't ask.
4. Testers. Internal testing (no review) is for members of his App Store Connect team, up to 100. Anyone else needs
   external testing, and Apple reviews its first build. External testers and the Beta App Review submission are his.

## The secrets Uni asks for (through a sealed secret card)

Three things, as the files Apple and Google give (Uni base64-encodes what needs it). Each goes into the repository's
Actions secrets; none is ever printed, pasted in chat or committed.

1. **App Store Connect API key** (Team key, role Developer): the `.p8` file, its Key ID, and the Issuer ID →
   `APPLE_API_KEY_P8`, `APPLE_API_KEY`, `APPLE_API_ISSUER`.
2. **Developer ID Application certificate** as a `.p12` and its password → `APPLE_CERTIFICATE` (base64),
   `APPLE_CERTIFICATE_PASSWORD`. Apple lets no API key make this certificate, so it comes from Aaron's Mac.
3. **A Google Cloud service account key** (JSON) for the Google Play Developer API. It is made in Google Cloud Console,
   then the service account's email is invited in Play Console → Users and permissions, on this app only, with "View
   app information", "Release apps to testing tracks" and "Manage testing tracks and edit tester lists". It lets Uni
   upload later builds to internal testing and keep the tester list. The first bundle has to be uploaded by hand in
   Play Console; no upload script exists yet.

The Play upload key is ours, not Aaron's: Uni makes it, before Aaron's first upload.

## Next, after Aaron's steps

| What | Who |
|---|---|
| Before Aaron's first upload: make the upload key on aero, set the four `PLAY_UPLOAD_*` secrets, build the `.aab` on aero (`scripts/android-build.sh --play`) and give it to Aaron | Uni |
| Set the five Apple secrets; run Mac by hand on `next`; check the summary says notarised | Uni |
| A reviewer account on a hub with a password (App access) | Uni |
| Report and block in rooms (user-generated content) | an app worker |
| The foreground-service video (emulator, 30 s) | Uni |
| Cloud account deletion inside the app | an app worker |
| The app's part on parachute.computer/privacy/ | Uni, with Aaron's go-ahead for the site |
| A Play upload script (service account), after the first manual upload | a worker |
| Add the play-test key's fingerprint under Android developer verification | Uni, before 2027 |
| iPhone: after Aaron's steps 1 and 2, run `scripts/ios-signing.mjs --secrets --group`, then tag a commit of `next` `testflight-<n>` and push the tag (build 1 to TestFlight) | Uni |
| iPhone: notifications while closed (Apple push), background recording, a save-to-folder picker | an app worker |
