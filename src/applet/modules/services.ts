// services module: what an applet may ask of the servers it declared (docs/design/SERVICES.md), through the shell's
// broker for its session (src/services/broker.ts). Without a broker (no service granted, or no key here) every call is
// not_granted. Bytes ride as an ArrayBuffer at `params.bytes` (contract.ts lets them past the request's budget).
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import type { Broker } from "../../services/broker.ts";
import { BrokerError } from "../../services/broker.ts";

const str = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max;
const ok = <T>(value: T) => ({ ok: true as const, value });
const no = { ok: false as const };

export function createServicesModule(broker: () => Promise<Broker | null>, why: () => string | null = () => null): UniModule {
  const b = async () => { const x = await broker(); if (!x) throw new ContractError(ERROR_CODES.notGranted, why() ?? "no service is open for it here"); return x; };
  const wrap = <T>(f: (x: Broker, p: T) => Promise<unknown> | unknown) => async (p: T) => {
    try { return await f(await b(), p); } catch (e) {
      if (e instanceof ContractError) throw e;
      // the native side fails with {code, message} (native.ts NativeError): its refusals are the applet's to hear
      if (e && typeof e === "object" && !(e instanceof Error) && typeof (e as { code?: unknown }).code === "string") {
        const { code, message } = e as { code: string; message?: string };
        throw new ContractError(code === "not_granted" ? ERROR_CODES.notGranted : code === "out_of_scope" || code.startsWith("hub_") ? ERROR_CODES.outOfScope : ERROR_CODES.failed, String(message ?? code).slice(0, 300));
      }
      if (e instanceof BrokerError) throw new ContractError(e.code === "not_granted" ? ERROR_CODES.notGranted : e.code === "out_of_scope" ? ERROR_CODES.outOfScope : e.code === "bad_params" ? ERROR_CODES.badParams : ERROR_CODES.failed, e.message);
      throw new ContractError(ERROR_CODES.failed, e instanceof Error ? e.message.slice(0, 300) : "it failed");
    }
  };
  const shape = (keys: string[], check: (p: Record<string, unknown>) => boolean) => (p: unknown) => (plain(p) && hasOnly(p, keys) && check(p) ? ok(p) : no);
  return {
    namespace: "services",
    methods: {
      me: { cap: null, validate: shape([], () => true), run: wrap((x) => x.me()) },
      fetch: {
        cap: null,
        validate: shape(["service", "path", "method", "headers", "body", "bytes", "as"], (p) => str(p.service, 40) && typeof p.path === "string" && p.path.length <= 2000
          && (p.method === undefined || str(p.method, 10)) && (p.headers === undefined || (plain(p.headers) && Object.keys(p.headers).length <= 10))
          && (p.body === undefined || typeof p.body === "string") && (p.bytes === undefined || p.bytes instanceof ArrayBuffer) && !(p.body !== undefined && p.bytes !== undefined)
          && (p.as === undefined || p.as === "text" || p.as === "json" || p.as === "bytes")),
        run: wrap((x, p: Record<string, unknown>) => x.fetch({ service: p.service as string, path: p.path as string, method: p.method as string | undefined, headers: p.headers as Record<string, string> | undefined, body: (p.bytes ?? p.body) as string | ArrayBuffer | undefined, as: p.as as "text" | "json" | "bytes" | undefined })),
      },
      subscribe: { cap: null, validate: shape(["service", "sub", "filters"], (p) => str(p.service, 40) && str(p.sub, 40)), run: wrap((x, p: Record<string, unknown>) => x.subscribe(p as { service: string; sub: string; filters: unknown })) },
      unsubscribe: { cap: null, validate: shape(["service", "sub"], (p) => str(p.service, 40) && str(p.sub, 40)), run: wrap((x, p: Record<string, unknown>) => x.unsubscribe(p as { service: string; sub: string })) },
      query: { cap: null, validate: shape(["service", "filters"], (p) => str(p.service, 40)), run: wrap((x, p: Record<string, unknown>) => x.query(p as { service: string; filters: unknown })) },
      publish: { cap: null, validate: shape(["service", "event"], (p) => str(p.service, 40)), run: wrap((x, p: Record<string, unknown>) => x.publish(p as { service: string; event: unknown })) },
      loadPrivate: { cap: null, validate: shape(["service", "d"], (p) => str(p.service, 40) && str(p.d, 40)), run: wrap((x, p: Record<string, unknown>) => x.loadPrivate(p as { service: string; d: string })) },
      savePrivate: { cap: null, validate: shape(["service", "d", "text"], (p) => str(p.service, 40) && str(p.d, 128) && typeof p.text === "string"), run: wrap((x, p: Record<string, unknown>) => x.savePrivate(p as { service: string; d: string; text: string })) },
      upload: { cap: null, validate: shape(["service", "bytes", "type"], (p) => str(p.service, 40) && p.bytes instanceof ArrayBuffer && str(p.type, 100)), run: wrap((x, p: Record<string, unknown>) => x.upload(p as { service: string; bytes: ArrayBuffer; type: string })) },
      media: { cap: null, validate: shape(["service", "sha256", "ext"], (p) => str(p.service, 40) && str(p.sha256, 64) && str(p.ext, 8)), run: wrap((x, p: Record<string, unknown>) => x.media(p as { service: string; sha256: string; ext: string })) },
    },
  };
}
