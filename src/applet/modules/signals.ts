// signals module (docs/design/APP-RECORD.md "Signals"): a running applet's own number for one of the signals its
// record declares, as the bar shows it and the person's other devices hear it (services/signals.ts). Rooms knows what
// the person has read and Mail what is unread; the vault and the gateway know only what arrived.
//   signals.set({id, count}) → null. id: a signal its record declares (an applet that declares none has none to set);
//                              count: 0 to 9999.
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";

export type SignalsDeps = { set(id: string, count: number): boolean };

export function createSignalsModule(deps: SignalsDeps): UniModule {
  return {
    namespace: "signals",
    methods: {
      set: {
        cap: null,
        validate: (p) => (plain(p) && hasOnly(p, ["id", "count"]) && typeof p.id === "string" && p.id.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id)
          && typeof p.count === "number" && Number.isInteger(p.count) && p.count >= 0 && p.count <= 9999 ? { ok: true, value: { id: p.id, count: p.count } } : { ok: false }),
        run: async ({ id, count }: { id: string; count: number }) => {
          if (!deps.set(id, count)) throw new ContractError(ERROR_CODES.outOfScope, "its record declares no signal by that id");
          return null;
        },
      },
    },
  };
}
