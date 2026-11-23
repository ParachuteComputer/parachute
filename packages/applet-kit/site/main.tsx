// An applet served as a website (site/vite.config.ts picks which: APPLET=…, the starter by default).
import { createRoot } from "react-dom/client";
import { LinkParachute } from "../src/LinkParachute.tsx";
import Applet from "applet-entry";

const info = { id: import.meta.env.VITE_APPLET_ID as string, name: import.meta.env.VITE_APPLET_NAME as string };
createRoot(document.getElementById("root")!).render(<LinkParachute applet={info}><Applet /></LinkParachute>);
