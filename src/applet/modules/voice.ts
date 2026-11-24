// voice module: the microphone, for an applet whose manifest says `reach: [voice]` and was allowed on its card
// (docs/design/KEYRING.md "Voice, files, links, storage"). The applet never touches the microphone: during a tap the
// shell opens its own recorder at the foot of the screen, beside the frame (which still scrolls), recording at once (a running time, its shape, Send, Cancel),
// records in its own document and, on Send, hands over the recording.
//   voice.record({max_s?})   → {bytes: ArrayBuffer, type: "audio/webm", duration: seconds} on Send, null on Cancel.
//                              max_s: 1 to 600 (10 minutes, the default)
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import { RECORD_MAX_S } from "../files.ts";

export type Recording = { bytes: ArrayBuffer; type: string; duration: number };
export type VoiceDeps = {
  /** The shell's recorder sheet: the recording on Send, null on Cancel. Throws `notTapped()` (app.ts) without a tap. */
  record(maxSeconds: number): Promise<Recording | null>;
};

export function createVoiceModule(allowed: boolean, deps: VoiceDeps): UniModule {
  return {
    namespace: "voice",
    methods: {
      record: {
        cap: null,
        validate: (p) => {
          if (!allowed) throw new ContractError(ERROR_CODES.notGranted);
          if (!plain(p) || !hasOnly(p, ["max_s"])) return { ok: false };
          const max = p.max_s === undefined ? RECORD_MAX_S : p.max_s;
          return Number.isInteger(max) && (max as number) >= 1 && (max as number) <= RECORD_MAX_S ? { ok: true, value: max as number } : { ok: false };
        },
        run: async (max: number) => deps.record(max),
      },
    },
  };
}
