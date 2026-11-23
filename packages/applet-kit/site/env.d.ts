/// <reference types="vite/client" />
// the applet site/vite.config.ts serves: a default-exported component
declare module "applet-entry" {
  const Applet: () => import("react").ReactNode;
  export default Applet;
}
