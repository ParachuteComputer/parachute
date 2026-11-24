// Public-domain fixture books for Library applet tests (T-476):
//   1. Henry David Thoreau — Walden (1854, Public Domain): 2 parts, 3 chapters, cover PNG, inline chapter illustration PNG,
//      chapter summaries and a whole-book summary.
//   2. Marcus Aurelius — Meditations (trans. George Long, 1862, Public Domain): 2 chapters, cover PNG, summary, and 1 seed quote.
import { deflateSync } from "node:zlib";

function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const rows = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    rows[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      rows[p++] = r;
      rows[p++] = g;
      rows[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Minimalist pine-and-pond cover art for Walden (180x270 PNG). */
export function waldenCoverPng(): Buffer {
  const W = 180, H = 270;
  return encodePng(W, H, (x, y) => {
    // Soft dawn sky -> pine treeline -> deep woodland pond
    if (y < 96) {
      const t = y / 96;
      return [Math.round(230 - t * 24), Math.round(224 - t * 14), Math.round(205 - t * 10)];
    }
    const ridge = 96 + Math.round(Math.sin(x / 18) * 8 + Math.cos(x / 7) * 4);
    if (y < ridge + 36) {
      return [42, 74, 58];
    }
    // Pond water with subtle horizontal ripples
    const ripple = (y % 9 === 0 && ((x + y * 3) % 23) < 11) ? 14 : 0;
    const t = Math.min(1, (y - 132) / (H - 132));
    return [Math.round(35 + t * 12 + ripple), Math.round(76 + t * 8 + ripple), Math.round(92 + t * 10 + ripple)];
  });
}

/** Inline landscape illustration for Chapter 2 of Walden (320x180 PNG). */
export function waldenPondPng(): Buffer {
  const W = 320, H = 180;
  return encodePng(W, H, (x, y) => {
    const sun = (x - 235) ** 2 + (y - 44) ** 2 < 18 ** 2;
    if (sun) return [236, 186, 118];
    const hills = 78 + Math.round(Math.sin(x / 42) * 14 + Math.cos(x / 17) * 5);
    if (y < hills) {
      const t = y / hills;
      return [Math.round(234 - t * 16), Math.round(222 - t * 18), Math.round(200 - t * 14)];
    }
    if (y < hills + 28) return [56, 86, 62];
    const shimmer = Math.abs(x - 235) < 26 && y % 6 < 2 ? 32 : 0;
    return [48 + shimmer, 88 + Math.round(shimmer * 0.7), 104 + Math.round(shimmer * 0.4)];
  });
}

/** Minimalist terracotta/stone cover art for Meditations (180x270 PNG). */
export function meditationsCoverPng(): Buffer {
  const W = 180, H = 270;
  return encodePng(W, H, (x, y) => {
    const border = x < 14 || x > W - 15 || y < 14 || y > H - 15;
    if (border) return [156, 94, 68];
    const inner = x === 20 || x === W - 21 || y === 20 || y === H - 21;
    if (inner) return [218, 198, 174];
    const arch = (x - 90) ** 2 + (y - 118) ** 2 < 46 ** 2 && y <= 118;
    const pillar = Math.abs(x - 90) < 46 && y > 118 && y < 210;
    if (arch || pillar) return [228, 214, 194];
    return [176, 112, 82];
  });
}

export type FixtureSpec = {
  walden: {
    bookPath: string;
    partOnePath: string;
    partTwoPath: string;
    ch1Path: string;
    ch2Path: string;
    ch3Path: string;
    bookSummaryPath: string;
    ch1SummaryPath: string;
    ch2SummaryPath: string;
    ch3SummaryPath: string;
  };
  meditations: {
    bookPath: string;
    ch1Path: string;
    ch2Path: string;
    ch1SummaryPath: string;
    quotePath: string;
  };
};

export const FIXTURE_PATHS: FixtureSpec = {
  walden: {
    bookPath: "Books/Walden",
    partOnePath: "Books/Walden/00 Part One - By the Pond",
    ch1Path: "Books/Walden/01 Economy",
    ch2Path: "Books/Walden/02 Where I Lived, and What I Lived For",
    partTwoPath: "Books/Walden/03 Part Two - The Quiet",
    ch3Path: "Books/Walden/04 Solitude",
    bookSummaryPath: "Books/Walden/Summaries/Book Summary",
    ch1SummaryPath: "Books/Walden/Summaries/01 Economy",
    ch2SummaryPath: "Books/Walden/Summaries/02 Where I Lived",
    ch3SummaryPath: "Books/Walden/Summaries/04 Solitude",
  },
  meditations: {
    bookPath: "Books/Meditations",
    ch1Path: "Books/Meditations/01 Book I - Debts and Lessons",
    ch2Path: "Books/Meditations/02 Book II - On the River Gran",
    ch1SummaryPath: "Books/Meditations/Summaries/01 Book I",
    quotePath: "Quotes/Meditations/2026-11-20 09-15 Look within",
  },
};

export function waldenBookBody(coverStoragePath: string): string {
  return [
    "# Walden; or, Life in the Woods",
    "",
    `![Cover](${coverStoragePath})`,
    "",
    "By Henry David Thoreau (1854, Public Domain).",
    "",
    "## Contents",
    "",
    "- [[Books/Walden/00 Part One - By the Pond|Part One – By the Pond]]",
    "  - [[Books/Walden/01 Economy|Economy]]",
    "  - [[Books/Walden/02 Where I Lived, and What I Lived For|Where I Lived, and What I Lived For]]",
    "- [[Books/Walden/03 Part Two - The Quiet|Part Two – The Quiet]]",
    "  - [[Books/Walden/04 Solitude|Solitude]]",
    "",
  ].join("\n");
}

export const WALDEN_CH1_BODY = [
  "When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only.[^1]",
  "",
  "The mass of men lead lives of quiet desperation. What is called resignation is confirmed desperation. From the desperate city you go into the desperate country, and have to console yourself with the bravery of minks and muskrats.",
  "",
  "Most of the luxuries, and many of the so-called comforts of life, are not only not indispensable, but positive hindrances to the elevation of mankind.",
  "",
  "[^1]: Thoreau moved into his cabin beside Walden Pond on July 4, 1845.",
  "",
].join("\n");

export function waldenCh2Body(pondStoragePath: string): string {
  return [
    "At a certain season of our life we are accustomed to consider every spot as the possible site of a house. I have thus surveyed the country on every side within a dozen miles of where I live.",
    "",
    "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
    "",
    `![Walden Pond at dawn](${pondStoragePath})`,
    "",
    "I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.",
    "",
    "Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand; instead of a million count half a dozen, and keep your accounts on your thumb-nail.",
    "",
    "Time is but the stream I go a-fishing in. I drink at it; but while I drink I see the sandy bottom and detect how shallow it is. Its thin current slides away, but eternity remains. Continue to [[04 Solitude|Solitude]].",
    "",
  ].join("\n");
}

export const WALDEN_CH3_BODY = [
  "This is a delicious evening, when the whole body is one sense, and imbibes delight through every pore. I go and come with a strange liberty in Nature, a part of herself.",
  "",
  "As I walk along the stony shore of the pond in my shirt-sleeves, though it is cool as well as cloudy and windy, and I see nothing special to attract me, all the elements are unusually congenial to me.",
  "",
  "The bullfrogs trump to usher in the night, and the note of the whip-poor-will is borne on the rippling wind from over the water. Sympathy with the fluttering alder and poplar leaves almost takes away my breath.",
  "",
  "I find it wholesome to be alone the greater part of the time. To be in company, even with the best, is soon wearisome and dissipating. I love to be alone. I never found the companion that was so companionable as solitude.",
  "",
  "We are for the most part more lonely when we go abroad among men than when we stay in our chambers. A man thinking or working is always alone, let him be where he will.",
  "",
].join("\n");

export const WALDEN_SUMMARIES = {
  book: "Thoreau records two years of deliberate, simple living in a small cabin beside Walden Pond, examining work, attention, solitude, and closeness to nature.",
  ch1: "Introduces the cabin at Walden Pond and questions how much of our daily labor goes toward habits and possessions we never truly needed.",
  ch2: "Explains the purpose of moving to the woods: to live deliberately, simplify affairs to two or three essentials, and stay awake to each morning.",
  ch3: "Reflects on evening walks by the pond and why quiet company with nature feels fuller and less lonely than restless crowds.",
};

export function meditationsBookBody(coverStoragePath: string): string {
  return [
    "# Meditations",
    "",
    `![Cover](${coverStoragePath})`,
    "",
    "By Marcus Aurelius, translated by George Long (1862, Public Domain).",
    "",
  ].join("\n");
}

export const MEDITATIONS_CH1_BODY = [
  "From my grandfather Verus I learned good morals and the government of my temper.",
  "",
  "From the reputation and remembrance of my father, modesty and a manly character. From my mother, piety and beneficence, and abstinence, not only from evil deeds, but even from evil thoughts; and further, simplicity in my way of living.",
  "",
  "Look within. Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.",
  "",
].join("\n");

export const MEDITATIONS_CH2_BODY = [
  "Begin the morning by saying to thyself, I shall meet with the busybody, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.",
  "",
  "Remember how long thou hast been putting off these things, and how often thou hast received an opportunity from the gods, and yet dost not use it.",
  "",
].join("\n");
