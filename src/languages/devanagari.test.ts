// IAST ↔ Devanagari in applets/languages.tsx: a Sanskrit word shows in both scripts, typed either way.
import { describe, expect, it } from "vitest";
import { L } from "./applet";

const { answersMatch, devanagariToIast, hasDevanagari, iastToDevanagari, sanskritPair } = L;

describe("IAST <-> Devanagari transliteration", () => {
  const PAIRS: [string, string][] = [
    ["atha", "अथ"],
    ["yoga", "योग"],
    ["yogānuśāsanam", "योगानुशासनम्"],
    ["citta", "चित्त"],
    ["vṛtti", "वृत्ति"],
    ["nirodhaḥ", "निरोधः"],
    ["tadā", "तदा"],
    ["draṣṭuḥ", "द्रष्टुः"],
    ["svarūpe", "स्वरूपे"],
    ["'vasthānam", "ऽवस्थानम्"],
    ["sārūpyam", "सारूप्यम्"],
    ["itaratra", "इतरत्र"],
    ["patañjali", "पतञ्जलि"],
    ["dharma", "धर्म"],
    ["śānti", "शान्ति"],
    ["kṛṣṇa", "कृष्ण"],
    ["jñāna", "ज्ञान"],
    ["kṣetra", "क्षेत्र"],
    ["oṃ", "ओं"],
    ["cit", "चित्"],
    ["vṛt", "वृत्"],
    ["rudh", "रुध्"],
    ["dṛś", "दृश्"],
    ["aiśvarya", "ऐश्वर्य"],
    ["auṣadha", "औषध"],
  ];

  it.each(PAIRS)("converts IAST %s -> Devanagari %s and back", (iast, deva) => {
    expect(iastToDevanagari(iast)).toBe(deva);
    expect(devanagariToIast(deva)).toBe(iast);
  });

  it("handles full Yoga Sutras 1.1–1.4 lines including dandas and avagraha", () => {
    expect(iastToDevanagari("atha yogānuśāsanam ||")).toBe("अथ योगानुशासनम् ॥");
    expect(iastToDevanagari("yogaś citta-vṛtti-nirodhaḥ ||")).toBe("योगश् चित्त-वृत्ति-निरोधः ॥");
    expect(iastToDevanagari("tadā draṣṭuḥ svarūpe 'vasthānam ||")).toBe("तदा द्रष्टुः स्वरूपे ऽवस्थानम् ॥");
    expect(iastToDevanagari("vṛtti-sārūpyam itaratra ||")).toBe("वृत्ति-सारूप्यम् इतरत्र ॥");
    expect(devanagariToIast("योगश्चित्तवृत्तिनिरोधः ॥")).toBe("yogaścittavṛttinirodhaḥ ||");
  });

  it("makes a word's pair from either script, and keeps both when both are given", () => {
    expect(sanskritPair("citta")).toEqual({ deva: "चित्त", iast: "citta" });
    expect(sanskritPair("", "citta")).toEqual({ deva: "चित्त", iast: "citta" });
    expect(sanskritPair("चित्त")).toEqual({ deva: "चित्त", iast: "citta" });
    expect(sanskritPair("चित्त", "citta")).toEqual({ deva: "चित्त", iast: "citta" });
    expect(sanskritPair("Nirodha")).toEqual({ deva: "निरोध", iast: "nirodha" });
    expect(sanskritPair("", "")).toEqual({ deva: "", iast: "" });
    expect(hasDevanagari("चित्त")).toBe(true);
    expect(hasDevanagari("citta")).toBe(false);
  });

  it("compares typed spelling/script practice answers with Unicode normalization", () => {
    expect(answersMatch("  चित्त ", "चित्त")).toBe(true);
    expect(answersMatch("El Corazón", "el corazón")).toBe(true);
    expect(answersMatch("el corazon", "el corazón")).toBe(false);
    expect(answersMatch("", "चित्त")).toBe(false);
  });
});
