---
"tegaki": patch
---

Fix the Astro adapter so passing `font={bundle}` hydrates without an explicit `bundle` prop and lookups by human-friendly font name resolve correctly. Animations now also re-hydrate after Astro View Transitions navigations.
