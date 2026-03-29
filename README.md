# speakEZ

Invite-only group chat for small tribes. Text, voice, video, recording, DMs. Runs on Cloudflare's free tier. No accounts. No servers. 

## THE PHILOSOPHY

Dunbar's number is the ceiling. Reach is a code smell. The invite _is_ moderation; that and kick. 

- Auth is a passphrase that becomes an ed25519 keypair. Nothing is stored; your phrase never leaves your brain. Forget the phrase, get a new invite, move on.
- Your pubkey is your identity. No accounts, no email, no recovery.
- Invites are single-use, 48 hours. 
- Chat is WebSockets backed up to R2. Voice is WebRTC P2P. No relay servers.

## FEATURES

- Text channels with markdown, emoji reactions, @mentions, replies
- Voice channels with per-person volume, DSP
- Video with grid view and full screen
- Session recording: one file per person, GREAT for podcasting
- DMs
- Custom emoji (drop any gif/png/svg in R2, use as `:filename:`)
- Push notifications for @mentions

## SETUP

You need a [Cloudflare account](https://cloudflare.com) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
git clone https://github.com/you/speakez
cd speakez
npm install
```

**KV namespace**
```bash
npx wrangler kv namespace create KV
```
Paste the returned `id` into `wrangler.toml`.

**R2 buckets**
```bash
npx wrangler r2 bucket create speakez-uploads
npx wrangler r2 bucket create speakez-emoji
```
`speakez-uploads` holds voice memos and avatars. `speakez-emoji` holds custom emoji.

**Secrets**
```bash
npx wrangler secret put ADMIN_SECRET
```
This is the password for generating invites. The first person in should be an admin — set their pubkey:
```bash
npx wrangler secret put ADMINS
```
Comma-separated pubkeys. Admins can create/delete/rename channels and categories.

**Push notifications (optional)**

Generate VAPID keys:
```bash
node test/scripts/gen-vapid.js
```
Then set the three secrets it prints:
```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY_JWK
npx wrangler secret put VAPID_SUBJECT
```
Skip this and push notifications just won't show up in the UI.

**Deploy**
```bash
npx wrangler deploy
```

## INVITES

Hit `/invite` with your `ADMIN_SECRET` to get an invite link. Send it to someone. They set a passphrase, they're in.

```
https://yourdomain.workers.dev/invite?secret=ADMIN_SECRET
```

## DEV

```bash
npm test
```
