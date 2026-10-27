# novabase

Official JavaScript SDK for **Novabase** — a lightweight Node.js BaaS platform with Postgres database, auto-generated REST API, realtime subscriptions, file storage and auth.

- Zero-config client, works in the browser and in Node.js
- Auto-generated REST API for every table (`db.from(...)`)
- Realtime subscriptions over WebSocket (`realtime.subscribe(...)`)
- File storage with signed URLs (`storage.from(bucket)`)
- Email / OAuth auth (`auth.signIn`, `auth.signUp`, `auth.getUser`)

## Install

```bash
npm install @hushaoqiong/novabase
# or
pnpm add @hushaoqiong/novabase
# or
yarn add @hushaoqiong/novabase
```

## Quick start

```ts
import { createClient } from '@hushaoqiong/novabase';

const novabase = createClient(
  'https://your-project.novabase.app', // project URL
  'your-api-key',                       // API key
);
```

### Database

```ts
// select
const { data, error } = await novabase
  .from('posts')
  .select('id,title')
  .eq('published', true)
  .order('created_at', 'desc')
  .limit(10)
  .execute();

// insert
await novabase.from('posts').insert({ title: 'Hello' }).execute();

// update / delete require .eq('id', rowId)
await novabase.from('posts').update({ title: 'Hi' }).eq('id', 1).execute();
await novabase.from('posts').delete().eq('id', 1).execute();
```

Supported filters: `eq` `neq` `gt` `gte` `lt` `lte` `like` `ilike` `is`.

### Realtime

```ts
const unsubscribe = novabase.realtime.subscribe('posts', (event) => {
  console.log(event.seq, event.type, event.table);
}, {
  onError: (error) => {
  console.error('Realtime subscription failed:', error.code, error.message);
  },
});

// later
unsubscribe();
```

Realtime events contain metadata only (`record` is `null`) and include `seq`, a PostgreSQL bigint encoded as a decimal string. The server stores metadata in a per-project-schema transactional outbox and replays retained events after the last cursor on reconnect. Consumers should de-duplicate by `seq` if they persist or share cursors. If the requested cursor is outside the retention window or replay exceeds the configured limit, the SDK reports `CURSOR_EXPIRED` through `onError`; fetch a fresh snapshot and pass its last processed cursor on the next subscription if your application persists cursors.

The cursor held by this SDK instance is in memory. To resume after a page reload or process restart, persist the latest successfully processed `event.seq` in your application and provide it as `since`:

```ts
const unsubscribe = novabase.realtime.subscribe('posts', onEvent, {
  since: savedCursor,
  onError: ({ code }) => {
    if (code === 'CURSOR_EXPIRED') void reloadPosts();
  },
});
```

Delivery is at least once within the retained replay window, not exactly once. A replay can overlap a live notification; consumers should make handling idempotent. The default retention is 24 hours and the replay cap defaults to 500 events (hard maximum 1,000). Expired or oversized gaps require snapshot reconciliation; no row contents or durable event payloads are exposed.

### Storage

```ts
const bucket = novabase.storage.from('avatars');

await bucket.upload(file);
const { data } = await bucket.list();
const { data: signed } = await bucket.getSignedUrl(objectId);
await bucket.remove(objectId);
```

### Auth

```ts
await novabase.auth.signUp({ email, password });
await novabase.auth.signIn({ email, password });
await novabase.auth.sendMagicLink(email);
novabase.auth.signInWithGoogle();
novabase.auth.signInWithGithub();
novabase.auth.signOut();
const user = novabase.auth.getUser();
```

## License

MIT
