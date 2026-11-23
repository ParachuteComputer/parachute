import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { vault } from "parachute";
import type { Book } from "./lib/format";

const Books = createContext<Book[] | null>(null);
export const useBooks = () => useContext(Books);

export function BooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[] | null>(null);
  useEffect(() => { vault.queryRecords({ pathPrefix: "Shelf/", limit: 50 }).then(setBooks, () => setBooks([])); }, []);
  return <Books.Provider value={books}>{children}</Books.Provider>;
}
