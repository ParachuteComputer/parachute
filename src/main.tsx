import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./shell/App";
import { applyToDocument } from "./theme/store";

// the person's look (the copy kept of their theme record, else the built-in one) before anything is drawn
applyToDocument();

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
