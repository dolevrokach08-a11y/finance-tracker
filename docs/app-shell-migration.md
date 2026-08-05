# HTML-first app shell migration

## What exists now

`app.html` is the new application entry point. It owns the persistent chrome,
session lifecycle, routing, and shared read model. The home dashboard is the
first migrated route and is split into three explicit pieces:

- `app/modules/home/home.html` — semantic HTML fragment.
- `app/modules/home/home.css` — route presentation.
- `app/modules/home/home.js` — `mount()` controller and cleanup.

There are no iframes and no extraction of live DOM from legacy documents. A
route either mounts as a real module in the shell or is explicitly marked as a
legacy navigation boundary.

## Runtime contracts

### Router

Routes live in `app/main.js`. A migrated route provides:

```js
{
  id: 'example',
  title: 'כותרת',
  subtitle: 'תיאור קצר',
  fragment: './app/modules/example/example.html',
  load: () => import('./modules/example/example.js')
}
```

The controller exports `mount(context)`. It may subscribe to the store, bind
events, and return a cleanup function. The router calls cleanup before mounting
another module. Route HTML remains independently inspectable and does not live
inside JavaScript template strings.

A route that has not been migrated provides `legacyUrl` instead. This makes the
boundary visible in configuration and easy to remove; it does not create a
second rendering architecture.

### Shared state

`app/core/store.js` is a small observable store. Its current top-level shape is:

```js
{
  session: { status, user, isDemo },
  data: { portfolio, finance, mortgage, cachedTwr },
  cloud: { status, updatedAt }
}
```

Modules read and subscribe; they do not initialize Firebase. Store updates
carry a reason string so later debugging and dev tooling can identify the
source of a state change.

### Firebase session

`app/core/firebase-session.js` is the only Firebase bootstrap in the shell. It:

1. resolves authentication once;
2. applies the existing per-user localStorage isolation before any read;
3. publishes cached data immediately after the authenticated user owns it;
4. refreshes the three Firestore documents without blocking first render;
5. never overwrites a dataset marked with unsynced local changes; and
6. listens to the existing `SyncBus` while legacy pages still own writes.

The migrated home route is deliberately read-only. Legacy pages keep their
battle-tested write/conflict flows until each domain is migrated. Do not add a
second save path to the shell in the meantime.

## How to migrate the next screen

1. Create `app/modules/<route>/<route>.html`, `.css`, and `.js`.
2. Move domain calculations into pure helper modules first; verify them against
   the current page before moving event handlers.
3. Add a domain data adapter under `app/data/` only when the migrated route is
   ready to own both reads and writes. Preserve the existing metadata and
   conflict rules.
4. Replace `legacyUrl` in the route registry with `fragment` and `load`.
5. Add the fragment to the service-worker shell cache and verify the production
   build copies it.
6. Keep the legacy HTML page as a fallback for one release. Remove it only after
   data parity, import/export parity, keyboard behavior, and mobile behavior are
   verified.

## Recommended order

1. Mortgage — comparatively isolated state and calculations; best second proof
   of the route lifecycle.
2. Tax — reuse the shared finance read model, then move its save adapter.
3. Finance — extract its domain state and chart lifecycle in vertical slices.
4. Portfolio — migrate last because it has the widest write surface, live price
   loading, imports, and the most complex conflict handling.

This order keeps every release usable and avoids a long-lived half-rewrite.

## Visual contract

Migration is not a neutral re-platforming. Every route must be redesigned while
it moves, using the same bold product system established by the shell and home:

- obsidian working surfaces with sharp editorial hierarchy;
- acid-lime as the product signal, not as a generic success color;
- a distinct secondary spectrum per domain (investment lime, cash-flow blue,
  mortgage coral, tax violet);
- large numeric typography and restrained mono labels for financial context;
- asymmetric, information-dense layouts that still collapse cleanly on mobile;
- motion only when it explains a state change or relationship; and
- shared spacing, borders, focus behavior, empty states, and loading language.

The shared legacy tokens and navigation already use this system so the product
becomes more coherent during migration. That layer is permanent design-system
work, not a disposable compatibility skin. A route is complete only when both
feature parity and the new visual standard are met.
