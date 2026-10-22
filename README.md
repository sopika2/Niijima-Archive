# Niijima Archive · the Thieves Den

A private collection for the Niijima Network, at `archive.niijimasisters.com`. It is themed on
the Thieves Den from Persona 5 Royal: a gallery of everything you've "stolen". Makoto is your
host. It keeps two kinds of things:

- **Tweets**, with your own caption: why you saved it. The text, author, date and every photo,
  GIF and video are copied to disk, so they stay even if the tweet is deleted.
- **Pictures, GIFs and short videos** you upload or share from your phone, each with an
  optional caption, tags and source link.

It is a personal bookmark and image collection. It has no sharing features and no public pages.

## What it does

- **Steal a tweet.** Paste an x.com or twitter.com link (any form: `?s=20`, `/photo/1`, mobile,
  fxtwitter…). The server reads it through FxTwitter (`api.fxtwitter.com`), with vxTwitter as a
  fallback, and downloads the files from `pbs.twimg.com` / `video.twimg.com`. A video too big for
  the limit is taken at a smaller quality. If the tweet can't be read, the link and caption are
  still saved, and the item gets a **Retry fetch** button.
- **Upload** many files at once: drag and drop or paste on desktop, the picker on the phone, with
  progress and a caption per file. Files are checked by their first bytes (JPEG, PNG, GIF, WebP,
  AVIF, MP4, MOV, WebM) and a size limit. Each gets a WebP thumbnail; animated GIFs show a still
  in the grid and play when opened. Files live on Mementos (your Zipline) when it is set up,
  otherwise in `data/media/<yyyy>/<mm>/<id>.<ext>`. Thumbnails always stay in `data/thumbs/`.
- **The Den:** a justified grid in saved order, loading more as you scroll. Filter by collection,
  tag or type, and search captions, tweet text, authors, tags and quoted tweets (SQLite FTS5).
  The lightbox steps through every file with ←/→ or a swipe, shows your caption, the tweet, its
  date on the calendar, tags and source. **Select** moves or deletes many at once.
- **Collections** with a cover (the newest picture, or one you pick), renaming, deleting (items
  stay, unsorted) and **Download .zip**: the files plus `captions.json`. "Download everything"
  does the same for all you can see.
- **Makoto and Sae.** The persona switch (shared with every Niijima site) decides what you see:
  her own items and collections plus the shared ones. Forms have a **Whose** field. The first start
  creates three collections: Makoto (Makoto's), Sae (Sae's) and Roman / Talia / Omi (shared).
- **Phone:** install it on Android and it appears in the share sheet (see below). On iPhone, use
  the iOS Shortcut.
- **Mementos (optional): Zipline as the storage.** See [Mementos](#mementos-zipline-as-the-storage).
- `/healthz` for the container health check, the 404 Palace for missing pages, "Take your time"
  on slow page loads.

## Set up on the server

You need Docker with Compose, your Traefik, and the Cloudflare Tunnel (the wildcard route already
covers `archive.niijimasisters.com`). The VM's 2 vCPU and 7.8 GB RAM are plenty.

```sh
git clone https://github.com/sopika2/Niijima-Archive ~/archive && cd ~/archive && cp .env.example .env && cp config.example.yml config.yml && nano .env && mkdir -p data assets && docker compose up -d --build
```

`mkdir -p data assets` makes the two folders as your user, so the container (running as
`PUID:PGID`) can write to `data/`.

In `.env`:

1. **Discord sign-in.** Use the Discord application you already have for Treasure: copy its
   Client ID and Secret, and under **OAuth2 → Redirects** add
   `https://archive.niijimasisters.com/auth/callback`.
2. **One sign-in for the whole Network.** Use the same `SESSION_SECRET` and
   `SESSION_DOMAIN=niijimasisters.com` in every Niijima app. They all use the same `nj_session`
   cookie, so signing in on one subdomain signs you in on all of them. Each app still checks its
   own `access.discord_user_ids` list.
3. **`PUBLIC_URL`** is the address you open. compose.yml also passes it to the server as
   `ORIGIN`. Behind Traefik and the tunnel the app only sees plain http. `ORIGIN` tells it the
   real `https://` address, so form posts pass the origin check and cookies are `Secure`.
4. **`SAVE_TOKEN`** (optional): `openssl rand -hex 32`, for the iPhone Shortcut.
5. **`ZIPLINE_URL` / `ZIPLINE_TOKEN`** (optional): keep every file on Mementos. See below.

In `config.yml`, put your Discord user id under `access.discord_user_ids`, in quotes. If you don't
know it, sign in once and the page shows it. Drop the host's picture into `assets/` as
`host.webp` (or name another file in `host.art`). Until then a silhouette stands in. No game art
is ever committed to this repo.

**Update:** `git pull && docker compose up -d --build`

| To change              | Edit         | Then                             |
| ---------------------- | ------------ | -------------------------------- |
| Host, limits, sign-ins | `config.yml` | `docker compose restart archive` |
| Host picture           | `assets/`    | Nothing; it shows on next load   |
| Secrets, tokens        | `.env`       | `docker compose up -d`           |
| The app itself         | `git pull`   | `docker compose up -d --build`   |

**Backups:** the Archive's part is in `data/` (`archive.db`, `thumbs/` and, without Mementos,
`media/`). Copy that folder, or use "Download everything" on the Collections page for a portable
.zip (it fetches the files from Mementos). With Mementos, the files themselves are backed up
wherever Zipline keeps them (your Google Drive).

## Mementos: Zipline as the storage

With `ZIPLINE_URL` and `ZIPLINE_TOKEN` in `.env`, your Zipline at
`https://mementos.niijimasisters.com` becomes where the Archive keeps its files. Built for
**Zipline v4** (tested against the API of v4.8); a Zipline v3 is recognised and the Mementos page
says it needs updating.

- **Every save goes to Zipline:** uploads, shares from the phone, tweet photos, GIFs and videos,
  and `/api/save`. The Archive keeps the Zipline file id and link plus a small thumbnail in
  `data/thumbs/`, so the grid stays fast. Its uploads go into a Zipline folder called **Archive**
  (`zipline.folder` in `config.yml`). If Zipline is down, the file is kept on disk and moved over
  later, so a save never fails because of Zipline.
- **Every item has its Mementos link** right away: **Copy Mementos link** in the lightbox.
- **Viewing and video** stream through the Archive from Zipline, with byte ranges so videos seek
  (and Safari plays them). Your browser only talks to the Archive: the token stays on the server,
  password-protected Zipline files still work, and the traffic between the two containers stays
  on the Docker network. **Download .zip** fetches the files from Zipline too.
- **Your own Zipline uploads** (phone, ShareX, Zipline's web page) appear in the Den by
  themselves, in a shared **Inbox** collection with thumbnails. The sync runs on start, every 5
  minutes (`zipline.sync_minutes`) and on **Sync now**. Files the Archive uploaded itself are never
  brought in twice. Pictures and videos only; other files are left alone. If you delete a file in
  Zipline, its item gets a **Gone** tag (it comes back if the file does).
- **Deleting an item** keeps its file on Zipline unless you tick **Also delete on Mementos**.
  A kept file is not brought back by the sync.
- **Moving what is already here:** on start, every file still in `data/media/` is uploaded, a
  background job, oldest first, that picks up where it stopped after a restart. The local copy is
  removed only after Zipline has sent back the very same bytes (size and SHA-256). If Zipline
  stores a changed copy (its "remove GPS metadata" setting, or compression), the original stays
  on disk for good, and the Mementos page tells you how many. Progress is on the **Mementos** page.

Set it up:

1. In Zipline, click your name (top right) → **Copy token** (or Settings → User → Token). Put it
   in `.env` as `ZIPLINE_TOKEN`.
2. `ZIPLINE_URL=https://mementos.niijimasisters.com`: the address links are made with.
3. `ZIPLINE_INTERNAL_URL` is where the Archive itself reaches Zipline. The default,
   `http://zipline:3000`, is Zipline's container on the `zipline_default` network the Archive is
   already on (it is the `TRAEFIK_NETWORK` default). If your Traefik network is a different one,
   add `zipline_default` to the Archive's networks in `compose.yml`, or set
   `ZIPLINE_INTERNAL_URL` to the public address.
4. `docker compose up -d`, then open **Mementos** in the Den to watch the move.

Without the two variables nothing changes: files stay on the Archive's disk, as before.

## From your phone

### Android: share straight into the Den

Open the Den in Chrome, sign in, then **⋮ → Add to Home screen → Install**. From then on,
**Thieves Den** is in the share sheet of the X app, your gallery and every other app. Sharing a
tweet (its link) or pictures opens a quick screen to add your caption and pick a collection.
Nothing is saved until you tap **Steal it**. Shares you never confirm are cleared after a day.

### iPhone: an iOS Shortcut

Safari doesn't support share targets, so on iPhone either paste the link on the **Steal** page,
or make a Shortcut that posts to `/api/save`:

1. Shortcuts → **+** → name it "Steal". Under its settings (ⓘ) turn on **Show in Share Sheet** and
   accept **URLs** and **Images**.
2. Add **Ask for Input** (Text, prompt "Why this one?") for the caption.
3. Add **Get Contents of URL**:
   - URL: `https://archive.niijimasisters.com/api/save`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your SAVE_TOKEN>`
   - Request Body: **Form**, with fields
     - `url` (Text) = _Shortcut Input_ (for links), or `file` (File) = _Shortcut Input_ (for pictures)
     - `caption` (Text) = _Provided Input_
     - `collection` (Text) = e.g. `Makoto` (optional; a name in any case, or an id)
4. Optionally add **Show Notification** with the result.

The same endpoint works from anywhere:

```sh
curl -H "Authorization: Bearer $SAVE_TOKEN" \
  -F url=https://x.com/jack/status/20 -F caption="The very first one" -F collection=Makoto \
  https://archive.niijimasisters.com/api/save
curl -H "Authorization: Bearer $SAVE_TOKEN" -F file=@picture.jpg -F caption="Talia" \
  -F collection="Roman / Talia / Omi" -F tags=edgerunners https://archive.niijimasisters.com/api/save
```

Fields: `url` and/or one or more files, plus optional `caption`, `collection`, `tags` (comma or
space separated) and `owner` (`makoto`, `sae` or `shared`; default: the collection's owner, else
shared). JSON bodies work too (`{"url": …, "caption": …}`). Answers `201` with the new items'
links, `200` with `"duplicate": true` for a tweet that is already saved, `401` for a wrong token
and `404` while `SAVE_TOKEN` is unset. The sign-in cookie is never accepted here.

## Security

- Every page, file and API needs the Discord sign-in. The exceptions are `/healthz`, the sign-in
  flow, the host's art, and `/api/save`, which needs its bearer token instead.
- Changing requests must come from this site (`Origin` check in `hooks.server.ts`). The two
  exceptions: `/api/save` (token only, cookies ignored) and the share target `/share`, which
  Android posts to without an Origin. `/share` only stages files for you to confirm, and the
  `SameSite=Lax` cookie never travels with another site's POST.
- The server only fetches from `api.fxtwitter.com`, `api.vxtwitter.com`, `pbs.twimg.com` and
  `video.twimg.com`, over https. The host is checked again on every redirect, and every fetch has a
  timeout and a size cap. Without internet access, fetches fail cleanly and pages still render.
- Tweet text is always shown as text (links are split out in code). There is no `{@html}` in the
  app, and eslint forbids it. A strict Content-Security-Policy is set on every page.
- Uploads are checked by their bytes, not their names. Files are served with their real type,
  `nosniff`, and a sandboxing CSP, also when they are streamed from Zipline (`/file/<id>`).
- The Zipline token never leaves the server; the browser only sees the public `/u/` links.

## Development

```sh
pnpm install
ACCESS_MODE=off pnpm dev    # http://localhost:5183, data in ./data
pnpm verify                 # prettier, eslint, svelte-check, tests, production build
```

Needs Node.js 22.18+ and pnpm 10. Without a `config.yml` the defaults apply.

```
src/lib/server/db/          schema, migrations' SQL source, items, collections, FTS search, scope
src/lib/server/tweet/       tweet links, the FxTwitter / vxTwitter normaliser, the API client
src/lib/server/media/       magic bytes, the disk store and thumbnails, the storage (Zipline or
                            disk), ranged file serving and the Zipline proxy
src/lib/server/save.ts      saving tweets and uploads; retry; delete
src/lib/server/api-save.ts  POST /api/save
src/lib/server/zipline.ts   the Zipline v4 API client
src/lib/server/mementos.ts  the migration to Zipline and the sync of her own Zipline uploads
src/lib/server/export.ts    .zip downloads
tests/fixtures/tweets/      real API answers recorded for the tests (tests never use the network)
tests/fixtures/zipline/     Zipline v4 and v3 answers, shaped from Zipline's source
tests/fake-zipline.ts       a small fake Zipline v4 for the tests; `node scripts/fake-zipline.ts`
                            runs it on :3999 for trying Mementos by hand
```

Schema changes: edit `src/lib/server/db/schema.ts`, run `pnpm db:generate`, and commit the new
file in `migrations/`. Migrations run on start. The PWA icons come from `static/icons/icon.svg`
(`pnpm icons`).
