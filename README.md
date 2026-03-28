# speakEZ

speakEZ is an _invite-only_, tribe-sized, ephemeral group chat. Voice and text. No moderation. No bullshit. It's built on Cloudflare Workers: KV + Durable Objects + R2; and runs on the free tier.

## The New Philosophy:
- Dunbar's number is the mantra
- Reach is a bad code smell. Always.
- Invite only. one-use/48hrs
- Auth is ed25519 async passphrase that never leaves your brain. NEVER stored.
- Your pubkey IS your identity. Also userId. 
- Rooms are permanent; Chat is WebSocket. Voice is WebRTC P2P.
- Threads are `replyTo` in message structure. One level deep ONLY.
- Moderation tools are: kick and MAYBE later, block at the user/pubkey level. 
- Otherwise moderation is social. The invite IS moderation.
- shared rooms between workers are a possible future feature.

## auth

Passphrase → PBKDF2 → ed25519 keypair. No stored secrets. No password reset. Forget your phrase, get a new invite, new pubkey. The phrase is the _only_ key.

Tokens are prefixed with your domain name and a random token: Single-use, 48 hour expiration invites. Your pubkey is stored, you're in. Add your name, avatar, whatever once inside. 

## setup

**prerequisites**
- [Cloudflare account](https://cloudflare.com) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Node.js 22+

**1. clone**
```bash
git clone https://github.com/you/speakez
cd speakez
npm install
```

**2. create KV namespace**
```bash
npx wrangler kv namespace create KV
```
paste the returned `id` into `wrangler.toml`.

**3. create R2 buckets**
```bash
npx wrangler r2 bucket create speakez-backup
npx wrangler r2 bucket create speakez-emoji
```
`speakez-backup` holds daily message backups. `speakez-emoji` holds your custom emoji — drop any gif/png/svg in and use it in chat as `:filename:` (extension stripped).

**4. set your admin secret**
```bash
npx wrangler secret put ADMIN_SECRET
```
this is the password for generating invites. keep it safe.

**5. deploy**
```bash
npx wrangler deploy
```
