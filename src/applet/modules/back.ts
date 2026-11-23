// back module: an applet with screens of its own holds Back (the kit's `onBack`, docs/WRITE-AN-APPLET.md). While it holds
// it, the app's Back (the bar's ‹, Android's Back) goes to the applet, which closes its own screen, and the person stays.
// Asked by the kit, not by applet code: `depth` is how many it holds (0: none). Nothing is granted, and the shell decides
// how many Backs to give (AppletScreen: one for each screen opened during a tap in it), so it can't keep anyone in.
//   back.hold({depth})
import { hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";

export const MAX_BACK_DEPTH = 100;

export function createBackModule(onHold: (depth: number) => void): UniModule {
  return {
    namespace: "back",
    methods: {
      hold: {
        cap: null,
        validate: (p) => (plain(p) && hasOnly(p, ["depth"]) && Number.isInteger(p.depth) && (p.depth as number) >= 0 && (p.depth as number) <= MAX_BACK_DEPTH ? { ok: true, value: p.depth } : { ok: false }),
        run: async (depth: number) => { onHold(depth); return null; },
      },
    },
  };
}
