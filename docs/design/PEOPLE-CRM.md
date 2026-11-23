# People as a personal CRM: what to learn from the good ones (T-476, 2026-11-23)

Aaron, 11-23: "I wonder about sorting it based on recency of connection or adding other more helpful features into
it… study how many CRMs work and look at that as inspiration." This note says what the personal CRMs and contact apps do
for a person's own life (not for sales), and which of those ideas People takes.

**Being judged:** whether the five built features below are the right ones, and whether the "not doing" list is right.

## What they do

| App | The ideas worth having | What to leave |
|---|---|---|
| **Dex** ([keep-in-touch docs](https://getdex.com/docs/workflows/keep-in-touch)) | A keep-in-touch frequency per person or per group. Next reminder = last interaction + frequency; any interaction, either way, resets it; "mark complete" restarts from today; snooze to a day. One timeline per person. | A red ❗ on overdue people and "X overdue" counts. Paid sync of Gmail, calendar and LinkedIn. |
| **Monica** ([docs](https://docs.monicahq.com/)) (open source, self-hostable) | How you know each other, important dates, conversations, calls and meals logged by hand, life events with your own types, reminders by email. | Logging everything by hand: it's a chore unless something fills it in. |
| **Clay / Mesh** ([me.sh](https://me.sh)) | A home feed of birthdays, reconnects and reminders; circles. | Capturing "every email, every meeting" and watching job changes and news: surveillance, not friendship. |
| **Folk** ([pricing](https://www.folk.app/pricing)) | Groups and reminders as plain tasks on a contact. | Sequences, enrichment quotas, pipelines: a team sales CRM. |
| **Covve** ([features](https://covve.com/features)) | Scan a card or a badge; voice notes. | An AI "research assistant" on people before you meet them. |
| **Garden, UpHabit** (App Store: [Garden](https://apps.apple.com/us/app/id1230466454), [UpHabit](https://apps.apple.com/us/app/id1335632832)) | The simplest form: pick how often for each person, get a nudge, leave a line about the last talk. | Habit framing: a score to keep up. |
| **Google Contacts** ([help](https://support.google.com/contacts/answer/7078226)) | Labels as groups, birthdays that show in Calendar, merge and fix duplicates, export to vCard. | No cadence, no timeline, notes are one plain field. |
| **iOS Contacts** | Contact Posters (how you show to others), birthdays in Calendar, CardDAV accounts. | No keep-in-touch or last contact; a second date (an anniversary) doesn't remind. |

Facts above were read from each app's own pages on 2026-11-23, except where a page didn't load: Covve's reminders,
UpHabit's circles and Monica's vCard export weren't confirmed, so nothing below depends on them.

## The ideas that recur

1. **When you were last in touch, worked out, not typed.** The good ones fill it from what already happened (meetings,
   messages) and leave a manual "we talked" for the rest.
2. **A cadence per person** ("every month"), with the next time computed from the last one. Any contact resets it.
3. **A short list of who's due**, on a home screen, not a count.
4. **One timeline per person**: notes, meetings, talks, newest first.
5. **How you met**, and the dates that matter, as plain fields.
6. **Groups as plain labels** that can carry a default cadence.
7. **Your data stays yours**: vCard out, CardDAV to the phone, self-hosted where possible.

## What makes them feel wrong

- **Red overdue counts and badges** (Dex): care turns into a backlog you're failing.
- **Streaks and scores** (habit apps): you keep a number up, not a friendship.
- **Enrichment and capture** (Mesh, Folk, Covve): pulling in job changes, posts and research on people feels like
  watching them.
- **Sales words** (Folk, Twenty): leads, sequences, pipelines.

## What People does

Built in T-476 round 2 (docs/PEOPLE.md, "In touch"):

1. **Last in touch, from the vault you already write.** The newest of a meeting, journal entry or note that links the
   person (on the note's own day) and a "We talked" line. Nothing scrapes mail or messages.
2. **Sort and filter by it.** Contacts sorts A–Z or Recent; the filter has "Last in touch": this week … never.
3. **Keep in touch.** A cadence per person in plain words (`every month`). The In touch tab shows who it's time to reach
   out to and who comes up this week. No count on the tab, nothing red, no streak.
4. **A timeline on each card**: talks, meetings, journal entries, notes, how you met, when they were added.
5. **How we met** (`how_we_met`, `met`), shown at the top of the card and at the start of the timeline.
6. **The phone's Contacts show the same people** (services/carddav, its own PR): CardDAV to DAVx5, only card facts, the vault is the
   one copy.

Next, in order (each a small, separate piece):

7. **Not now.** Snooze a due person to a day (Dex's snooze), kept as a field so it survives devices.
8. **Dates that matter beyond birthdays**: anniversaries, a move, a new baby, as a `dates` list with labels, shown in
   Birthdays (renamed "Dates") and the timeline.
9. **A group's cadence**: "Close friends: every month" as the default for anyone in it, overridable per person.
10. **Room messages count as contact**: a `nostr` key on the person and a read-only relay grant for People. It asks for
    a new permission, so it waits for Aaron's yes.

Not doing: enrichment from mail, LinkedIn or the web; automatic capture of messages; streaks; red counts; pipelines.
