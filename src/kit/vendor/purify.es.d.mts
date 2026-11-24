// The part of DOMPurify's API the kit uses (purify.es.mjs, vendored: VENDORED.md). Its own typings import
// `trusted-types`, which this repo doesn't have.
export type Config = {
  USE_PROFILES?: { html?: boolean; svg?: boolean; svgFilters?: boolean; mathMl?: boolean } | false;
  FORBID_TAGS?: string[];
  FORBID_ATTR?: string[];
  ALLOW_DATA_ATTR?: boolean;
  ALLOW_ARIA_ATTR?: boolean;
  RETURN_DOM_FRAGMENT?: boolean;
};
export interface DOMPurify {
  (root?: Window): DOMPurify;
  isSupported: boolean;
  version: string;
  removed: unknown[];
  sanitize(dirty: string | Node, cfg: Config & { RETURN_DOM_FRAGMENT: true }): DocumentFragment;
  sanitize(dirty: string | Node, cfg?: Config): string;
}
declare const purify: DOMPurify;
export default purify;
