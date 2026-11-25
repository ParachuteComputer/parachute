# Vendored

## DOMPurify 3.5.0

`purify.es.mjs` is `dist/purify.es.mjs` from the npm package `dompurify@3.5.0`, unchanged
(https://github.com/cure53/DOMPurify, Cure53, MPL-2.0 OR Apache-2.0; `DOMPURIFY-LICENSE`). The kit's mail renderer
(`../mailClean.ts`) sanitizes a message's HTML with it before anything else touches it.

- The package's tarball matched the registry's integrity
  (`sha512-LYC0ZkE8P1V42JsRYTwMdme/2ET8SpOc5AA2eOFjP/IadvRd2fwiT4TVz5vkfy0XUx12aS2UaRkTnfVPNOv9vw==`) when it was taken.
- `sha256 5e8c53cd086a012531fc754ee6a7ad7a02e8a06fc4dadd805b912e128c3f6c58` is the file's hash;
  `../mailClean.test.ts` fails if the file changes without this line changing with it.
- `purify.es.d.mts` is ours: the few calls the kit makes (the package's own typings import `trusted-types`).

To move to a new version: `npm pack dompurify@<v>`, check the tarball's sha512 against `npm view dompurify@<v>
dist.integrity`, copy `package/dist/purify.es.mjs` here, put its sha256 above and in the test, read the release notes,
and run `npx vitest run src/kit/mailClean.test.ts` and `scripts/mutate-mail.ts`.
