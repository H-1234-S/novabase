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
  console.log(event);
});

// later
unsubscribe();
```

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
