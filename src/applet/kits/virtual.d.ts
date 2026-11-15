declare module "virtual:vault-client-kit" {
  /** surface-client's VaultClient bundled to an IIFE that sets `window.__UniVC`. */
  const source: string;
  export default source;
}
declare module "virtual:react-kit" {
  /** React, ReactDOM and the JSX runtime bundled to an IIFE that sets `window.__ParachuteModules`. */
  const source: string;
  export default source;
}
declare module "virtual:frame-kit" {
  /** The frame's bundle (src/frame/entry.tsx) as one script, and its styles. */
  const kit: { js: string; css: string };
  export default kit;
}
