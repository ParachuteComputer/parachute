// techne module: an applet acts on Techne as the person (docs/design/TECHNE.md), through the shell. `me()` says who it
// acts as; `call(method, {params, input})` makes one AppView call. Every call is checked here against the capability
// table and what the applet holds now (techne.ts `checkCall`, read again at each call, so a Take back counts at once): a
// method no capability lists is refused; a write it hasn't been given asks the person on the shell's sheet, only during
// a tap in the applet; its yes is a signed approval of that one capability (techneGrants.ts). The request itself goes
// through the shell's own broker for the AppView, which signs it with the person's key; the applet never sees either.
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import { checkCall, type Techne, type TechneCap } from "../techne.ts";
import { notTapped } from "./app.ts";

export type TechneDeps = {
  /** The write capabilities it holds now. */
  held(): Promise<ReadonlySet<TechneCap>>;
  /** The shell's own yes or no for a write capability, after a tap in the applet. */
  ask(cap: Exclude<TechneCap, "read">): Promise<"yes" | "no" | "untapped">;
  /** Hold it (signed on a device with the key). Throws when it couldn't be (the unlock cancelled). */
  grant(cap: Exclude<TechneCap, "read">): Promise<void>;
  /** One signed request to the AppView: `GET /xrpc/<nsid>?params` or `POST /xrpc/<nsid>` with a JSON body. */
  send(http: "GET" | "POST", nsid: string, params: Record<string, string>, input: unknown): Promise<{ status: number; body: unknown }>;
  /** Who the shell signs in as. */
  me(): Promise<{ did: string; handle?: string }>;
};

const ok = <T>(value: T) => ({ ok: true as const, value });
const no = { ok: false as const };
const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
type Call = { method: string; params: Record<string, string | number | boolean>; input: unknown };

/** An answer that isn't 2xx, in the applet's words: XRPC's `{error, message}` when there is one. */
const refusedBy = (status: number, body: unknown) => {
  const b = plain(body) ? body : {};
  const what = [typeof b.error === "string" ? b.error : null, typeof b.message === "string" ? b.message : null].filter(Boolean).join(": ");
  return new ContractError(ERROR_CODES.failed, `Techne answered ${status}${what ? ` (${what.slice(0, 200)})` : ""}`);
};

export function createTechneModule(t: Techne | null, deps: TechneDeps): UniModule {
  const need = () => { if (!t) throw new ContractError(ERROR_CODES.notGranted, "its card doesn't ask for Techne"); return t; };
  return {
    namespace: "techne",
    methods: {
      me: { cap: null, validate: (p) => (plain(p) && hasOnly(p, []) ? ok(p) : no), run: async () => { need(); return deps.me(); } },
      call: {
        cap: null,
        validate: (p) => (plain(p) && hasOnly(p, ["method", "params", "input"]) && typeof p.method === "string" && p.method.length <= 200
          && (p.params === undefined || (plain(p.params) && Object.keys(p.params).length <= 20 && Object.values(p.params).every(scalar)))
          ? ok({ method: p.method, params: (p.params ?? {}) as Call["params"], input: p.input }) : no),
        run: async (c: Call) => {
          const techne = need();
          let check = checkCall(techne, await deps.held(), c.method);
          if (!check.ok && "ask" in check) {
            const cap = check.ask;
            const said = await deps.ask(cap);
            if (said === "untapped") throw notTapped();
            if (said === "no") throw new ContractError(ERROR_CODES.notGranted, "you didn't allow it this time");
            await deps.grant(cap);
            // held as signed, read back: a grant that didn't take leaves it asking
            check = checkCall(techne, await deps.held(), c.method);
            if (!check.ok) throw new ContractError(ERROR_CODES.notGranted, "it wasn't allowed");
          }
          if (!check.ok) throw new ContractError(ERROR_CODES.outOfScope, "refused" in check ? check.refused : "not allowed");
          if (check.http === "GET" && c.input !== undefined) throw new ContractError(ERROR_CODES.badParams, `${c.method} takes params, not input`);
          const params = Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, String(v)]));
          const res = await deps.send(check.http, c.method, params, c.input);
          if (res.status < 200 || res.status > 299) throw refusedBy(res.status, res.body);
          return res.body;
        },
      },
    },
  };
}
