// Techne (docs/design/TECHNE.md): your profile and your recent posts on Techne, read as you with your key, and a line to
// post in one of your circles. Reading is on its card; the first post asks you, on Parachute's own sheet, and your yes
// is signed for this one thing. Install: scripts/install-applets.ts techne --set techne=<the AppView's origin>
// --set circle=<a circle's DID>.
import { useEffect, useState } from "react";
import { Empty, List, Loading, Page, Problem, ready, techne, toast, when, Write } from "parachute";

type Profile = { did: string; handle?: string; displayName?: string; bio?: string };
type Rec = { uri: string; value: { text?: string; createdAt?: string }; time: string };

// the circle a post goes to (createCirclePost's `collective`), filled in when it is installed
const CIRCLE = "{{circle}}";
const POSTS = (limit: number) => ({ query: JSON.stringify({ where: { all: [{ type: { is: "pub.techne.draft.post" } }, { author: { is: "$viewer" } }] } }), limit });

export default function Techne() {
  const [me, setMe] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Rec[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const who = await techne.me();
      const [profile, recent] = await Promise.all([
        techne.call<Profile>("social.scenius.getProfile", { params: { did: who.did } }),
        techne.call<{ records: Rec[] }>("pub.techne.draft.query.listRecords", { params: POSTS(10) }),
      ]);
      setMe(profile);
      setPosts(recent.records);
      setError(null);
    } catch (e) { setError(e); }
  };
  useEffect(() => { ready().then(load); }, []);

  const post = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      // the first time, Parachute asks you whether it may post as you; Not now leaves it unsent
      await techne.call("social.scenius.createCirclePost", { input: { collective: CIRCLE, post: { text: t, createdAt: new Date().toISOString() } } });
      setText("");
      toast("Posted");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not posted");
    } finally { setBusy(false); }
  };

  const name = me?.displayName || me?.handle || "You";
  return (
    <Page kicker="Techne" title={me ? name : "Techne"} onRefresh={load}>
      {error ? <Problem error={error} onRetry={load} /> : me === null ? <Loading /> : <>
        {me.handle && <p className="quiet">@{me.handle}</p>}
        {me.bio && <p>{me.bio}</p>}
        <Write label="Post in your circle" labelled value={text} onChange={setText} onSend={post} send="Post" canSend={!!text.trim()} busy={busy} maxLength={2000} />
        {posts && posts.length
          ? <List label="Your recent posts" rows={posts.map((p) => ({ key: p.uri, title: p.value.text ?? "", meta: when.day(p.value.createdAt ?? p.time) }))} />
          : <Empty>Nothing posted yet.</Empty>}
      </>}
    </Page>
  );
}
