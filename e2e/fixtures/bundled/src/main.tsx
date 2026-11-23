// A small React project of several files, as a web developer writes one: a context, two views, a helper, an npm package.
import { Page, Tabs, useSaved } from "parachute";
import { BooksProvider } from "./state";
import { Books } from "./views/Books";
import { About } from "./views/About";

export default function Shelf() {
  const [tab, setTab] = useSaved("tab", "books");
  return (
    <BooksProvider>
      <Page title="Shelf">
        <Tabs label="Shelf" current={tab} onChange={setTab} tabs={[{ key: "books", label: "Books" }, { key: "about", label: "About" }]} />
        {tab === "books" ? <Books /> : <About />}
      </Page>
    </BooksProvider>
  );
}
