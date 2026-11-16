// The tab's history, as react-router keeps it (its `idx` in history.state).

/** Is this the first entry of the tab's history (a start, a link from outside)? Back there goes to the launcher. */
export const atFirstEntry = () => ((history.state as { idx?: number } | null)?.idx ?? 0) === 0;
