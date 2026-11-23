// back module: an applet with screens of its own holds Back (the kit's `onBack`, docs/WRITE-AN-APPLET.md "Back"). While
// it holds it, the app's Back (the bar's ‹, a phone's Back) goes to the applet: it closes its own screen, and the person
// stays in it. Asked by the kit, not by applet code: `held` is only whether it has a screen to close. Nothing granted.
//   back.hold({held})
import { hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";

export function createBackModule(onHold: (held: boolean) => void): UniModule {
  return {
    namespace: "back",
    methods: {
      hold: {
        cap: null,
        validate: (p) => (plain(p) && hasOnly(p, ["held"]) && typeof p.held === "boolean" ? { ok: true, value: p.held } : { ok: false }),
        run: async (held: boolean) => { onHold(held); return null; },
      },
    },
  };
}
