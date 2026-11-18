// The native side in the app on a device: Tauri commands (src-tauri/src/services.rs).
import type { Native } from "./native";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** A grant's subject joins vault and note with a NUL (applet/grants.ts subjectOf); the native side takes plain text. */
export const plainSubject = (subject: string) => subject.replace(/\u0000/g, " | ");

export const shellNative: Native = {
  open: (session, applet, services, hubs) => invoke("svc_open", { session, applet: { ...applet, subject: plainSubject(applet.subject) }, services, hubs }),
  close: (session) => invoke("svc_close", { session }),
  relayAuth: (session, service, challenge) => invoke("svc_relay_auth", { session, service, challenge }),
  signEvent: (session, service, template) => invoke("svc_sign_event", { session, service, template }),
  http: (session, service, req) => invoke("svc_http", { session, service, req }),
  upload: (session, service, body, type) => invoke("svc_upload", { session, service, body, type }),
  media: (session, service, sha256, ext) => invoke("svc_media", { session, service, sha256, ext }),
  privateOpen: (session, service, event) => invoke("svc_private_open", { session, service, event }),
  privateSave: (session, service, d, text) => invoke("svc_private_save", { session, service, d, text }),
  tokenSet: (subject, service, token) => invoke("svc_token_set", { subject: plainSubject(subject), service, token }),
  tokenHas: (subject, service) => invoke("svc_token_has", { subject: plainSubject(subject), service }),
  log: (subject) => invoke("svc_log", { subject: plainSubject(subject) }),
  cardView: (session, service, event) => invoke("svc_card_view", { session, service, event }),
  cardTrust: (session, service, event, name) => invoke("svc_card_trust", { session, service, event, name }),
  cardAnswer: (session, service, event, decision, rids) => invoke("svc_card_answer", { session, service, event, decision, rids }),
  cardSent: (session, service, card, rid) => invoke("svc_card_sent", { session, service, card, rid }),
  secretView: (session, service, event) => invoke("svc_secret_view", { session, service, event }),
  secretSend: (session, service, event, value) => invoke("svc_secret_send", { session, service, event, value }),
  secretForget: (session, service, event) => invoke("svc_secret_forget", { session, service, event }),
  keyring: () => invoke("keyring_status"),
};
