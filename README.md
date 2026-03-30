# speakEZ

Group chat that stops at your circle. Invite-only. Not a platform. A sovereign signal. No accounts. No tracking. No one in the middle. 

Text, voice, and video running on Cloudflare's free tier.

## THE PHILOSOPHY

[Dunbar's number](https://en.wikipedia.org/wiki/Dunbar's_number) is the ceiling. Reach is a bad design smell. The invite _is_ moderation; that and kick. 

* **Identity vai Math**: Your passphrase becomes an [ed25519](https://ed25519.cr.yp.to/) keypair; public key becomes your userId. Your passphrase is _never_ stored and should never leave your brain. If you forget it, get a new invite and move on.
* **No Paper Trails**: No accounts, no emails, no recovery, and no facial scans. Your public key is your identity.
* **Gatekeeping by Design**: Invites are single-use and expire in 48 hours.
* **No Middlemen**: Chat is WebSockets backed by Durable Objects and R2. Voice is WebRTC P2P.

## FEATURES

* **Channels**: Text with markdown, emoji reactions, @mentions, and replies.
* **Comms**: Voice channels with per-person volume and DSP. Video with grid or full-screen views.
* **Recording**: Hi-fi session recording: one file per person. Perfect for podcasting or TTRPG actual plays.
* **DMs**: Private messages that exist until everyone invited leaves. 
* **Voice Memos**: Record and share your words.
* **Notifications**: Native push notifications for @mentions.

![have a peek](assets/images/screenshot.png)

## SETUP

You need a [Cloudflare account](https://cloudflare.com) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
git clone https://github.com/qualityshepherd/speakez
cd speakez
npm install
```

**1. Infrastructure**
Create your KV namespace and R2 buckets:
```bash
npx wrangler kv namespace create KV
npx wrangler r2 bucket create speakez-uploads
npx wrangler r2 bucket create speakez-emoji
```
Paste the KV `id` into your `wrangler.toml`.

**2. Secrets**
Set your admin credentials:
```bash
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put ADMINS
```
`ADMINS` is a comma-separated list of public keys.

**3. Deploy**
```bash
npx wrangler deploy
```

## ACCESS

Generate an invite link by hitting the `/invite` endpoint with your `ADMIN_SECRET`:

`https://yourdomain.workers.dev/invite?secret=ADMIN_SECRET`

Send the link. They set a passphrase. They are in.

## LICENSE

AGPL-3.0-or-later.
