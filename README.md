# speakEZ

Group chat that stops at your circle. Invite-only. Not a platform, a sovereign signal. No accounts. No tracking. No one in the middle.

Text, voice, and video running on Cloudflare's free tier.

## THE PHILOSOPHY

[Dunbar's number](https://en.wikipedia.org/wiki/Dunbar's_number) is the ceiling. Reach is a design smell. The invite _is_ moderation. That and kick.

* **Zero-knowledge Login**: Your passphrase becomes an Ed25519 keypair. The public key is your user ID. Your passphrase is never stored and should never leave your head. Forget it, and you start over.
* **No Paper Trails**: No accounts. No emails. No recovery flows. No biometric scans. Your public key is your identity.
* **Limited Access by Design**: Invites are single-use and expire in 48 hours.
* **No Middlemen**: Chat runs over WebSockets backed by Durable Objects and R2. Voice runs peer-to-peer over WebRTC.
* **Sovereignty over Scalability**


## FEATURES

* **Channels**: Text with markdown, emoji reactions, @mentions, and replies.
* **Voice & Video**: Live voice channels with per-person volume and DSP. Video with grid and full-screen views.
* **Recording**: Hi-fi session recording with one track per person. Built for podcasts and TTRPG actual plays.
* **DMs**: Private messages that persist until the last person leaves.
* **Voice Memos**: Record and share your voice, async.
* **Notifications**: Native push notifications for @mentions.

![have a peek](./assets/images/screenshot.png)

## STACK

- Cloudflare Workers + Durable Objects + KV + R2
- Ed25519 for identity (passphrase → keypair)
- WebSockets for chat, WebRTC for voice/video
- FTS5 SQLite for message search
- Alarm-based backup to R2

## SETUP

You need a [Cloudflare account](https://cloudflare.com) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
git clone https://github.com/qualityshepherd/speakez
cd speakez
npm install
```

**1. Authenticate**
```bash
npx wrangler login
```

**2. Infrastructure**

Create your KV namespace and R2 bucket:
```bash
npx wrangler kv namespace create KV
npx wrangler r2 bucket create speakez-backup
```
Paste the KV `id` into `wrangler.toml`.

**3. Config**

Edit `wrangler.toml`:
- Set `DOMAIN` to your Worker's domain (e.g. `speakez.yourname.workers.dev`)
- Set `OWNER` to your public key (you'll get this after first login)

**4. Secrets**
```bash
npx wrangler secret put ADMIN_SECRET
```
`ADMIN_SECRET` is the password you'll use to generate invite links.

**5. Deploy**
```bash
npx wrangler deploy
```

## ACCESS

### Invite flow

```
Admin                          Invitee
  |                               |
  |-- GET /invite?secret=xxx ---> Worker
  |<-- { link: https://...?invite=TOKEN } --
  |                               |
  |-- sends link to invitee ----> |
  |                               |
  |                  opens link --+
  |                               |
  |              sets passphrase --+
  |                               +-- passphrase → Ed25519 keypair (in browser)
  |                               |
  |                  GET /register?invite=TOKEN&pubkey=... --> Worker
  |                               |              marks invite used, stores pubkey
  |                               |<-- 200 OK --
  |                               |
  |                        logs in +-- passphrase → keypair → sign challenge
  |                               |
  |                               +-- they're in
```

Generate an invite link:

```
https://yourdomain.workers.dev/invite?secret=YOUR_ADMIN_SECRET
```

| OR just use the `Invite` link in the app's speakEZ menu.

Send the link. They set a passphrase. They're in.

### Getting your public key

After your first login, go to **Settings → Profile**. Your public key is shown there. Set it as `OWNER` in `wrangler.toml` and redeploy to claim admin privileges.

## HEALTH

```
GET /api/health
```
Returns binding status and timestamp. Point an uptime monitor here.

## LICENSE

AGPL-3.0-or-later.
