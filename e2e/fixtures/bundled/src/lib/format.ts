import ms from "ms";
export type Book = { id: string; path: string; updatedAt: string | null };
export const titleOf = (b: Book) => b.path.replace(/^Shelf\//, "");
/** How long a loan runs, said as the npm package `ms` says it. */
export const loan = () => ms(ms("14 days"), { long: true });
