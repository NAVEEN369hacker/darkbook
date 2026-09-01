# 00 — Product Overview

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). Two identifiers: a permanent, server-internal **Device ID (DID)** and a daily-rotating, user-visible **User ID (UID)**. All social state (posts, comments, votes, follows, DMs) is wiped at every UTC midnight. DMs are end-to-end encrypted — the server cannot read them.

## 1. Vision

**Ghostline** is a hyper-anonymous social platform. Anyone can install, post, comment, react, and DM in seconds. There are no emails, no phone numbers, no passwords the user types, no real names, and **no persistent social identity** — every UTC midnight, your handle and all your social history evaporate. The platform keeps a permanent, invisible Device ID only so it can fight abuse and answer lawful process; that ID is never shown to users or other users.

The product is structured so that:

1. The platform is genuinely useful to honest users from the very first tap.
2. The cost of mass abuse is high and the cost of legitimate use is near zero.
3. The platform can comply with lawful legal process — with the explicit, public limitation that DM contents are end-to-end encrypted and we cannot produce plaintext.

## 2. Goals (v2)

| Goal | Metric | Target |
|---|---|---|
| Time-to-first-post | install → first post | < 60s |
| Anonymity transparency | banner + daily rotation UI | 100% shown |
| Cold-start engagement | DAU/MAU | ≥ 0.25 |
| Abuse take-down | report → action | < 5 min p95 |
| Server-side retention | minimal logs TTL | 14 days |
| Daily rotation | every UTC midnight | 100% of active devices |
| Daily purge | posts/follows/DMs of expired UID | ≤ 5 min after rotation |
| E2E DM coverage | DMs decryptable only on recipient device | 100% |

## 3. Non-goals (v2)

* No persistent follower graph across days. (Follows are same-day only.)
* No "tomorrow me knows what today me said" — by design, content history does not survive 24 hours.
* No real-name verification.
* No public profile pages — every post is the unit of identity.
* No algorithmic personalization that creates a filter bubble (v2 is chronological + mild "hot" tab).
* No crypto / token / rewards in v2.
* **No plaintext DMs.** DMs are end-to-end encrypted. Period.

## 4. Personas

1. **Lurker** — reads, upvotes, rarely posts. Wants zero friction.
2. **Confessor** — posts about sensitive topics (mental health, workplace). Wants strong anonymity.
3. **Troll** — attempts to abuse. We optimize to make this expensive.
4. **Moderator** — internal employee with admin console. Sees reported content, never user PII (none exists).

## 5. Core user stories

* As a user, I can install the app, get a random name ("Blue Panda"), and post in under a minute.
* As a user, I see clearly that my name and all my posts will change and be erased at midnight UTC.
* As a user, I can see a chronological feed of posts from everyone nearby or in my selected rooms.
* As a user, I can comment, upvote, downvote, and share a post link.
* As a user, I can DM another user **today**, knowing the conversation disappears at midnight. The server cannot read my DMs.
* As a user, I can follow another user **today**. Tomorrow, both of us start with zero followers.
* As a user, I can report a post; the report is acted on without my identity being revealed to the reported user.
* As a user, I can delete my own posts at any time (and they disappear from the server).
* As a user, I can rotate my display name once per day (cosmetic, doesn't change the underlying UID).
* As a user, I can see why my post was removed (generic reason) and how to appeal.

## 6. Threat model

| Threat | Mitigation |
|---|---|
| Mass sock-puppet creation | One permanent DID per device, lifetime-bounded. Rate limits and ban state live on the DID, so a UID rotation cannot reset them. |
| "Wait for midnight to escape a ban" | Bans live on the DID, not the UID. Daily UID rotation does not reset abuse score or status. |
| CSAM / illegal content | Hash-based matching (PhotoDNA / PDQ) + NCMEC CyberTipline + immediate takedown. Posts held under legal hold do not bypass purge of plaintext social state. |
| Doxxing via screenshot | Screenshot detection (iOS `UIScreen.capturedDidChangeNotification`, Android `FLAG_SECURE`) — blurs app in app switcher, blocks screenshots on sensitive screens. UID rotates daily so even a captured UID expires in ≤24h. |
| Doxxing via DM | DMs are E2E encrypted; the server has no plaintext. We can produce ciphertext under legal order but cannot read it. |
| Spam | AI content filter, per-DID rate limits, CAPTCHA escalation, shadow ban, daily cooldown for new devices |
| Brigading | Outlier-vote detection: sudden vote velocity on a single post from low-rep accounts collapses the score |
| Legal compulsion | Server holds DID + UID + IP + UA. We can produce records in response to a valid order; we hold no name/email/phone. For DMs, we can produce only ciphertext. |
| Server breach | At-rest encryption; DIDs are opaque; social content is text + ephemeral media refs; DMs are ciphertext only |
| Stalker on shared device | Reinstall = new DID only after 30-day reservation. No persistent local social profile. |
| Abuse via VPN rotation | Behavioral fingerprint + device keypair + DID-bound abuse score. New devices from same fingerprint inherit abuse history. |
| Daily rotation as an attack window | Rate limits per-hour not per-day, abuse score is sliding, so spamming during the brief rotation window does not grant a clean slate. |

## 7. Privacy promise (in-app copy)

> **You are anonymous here.**
>
> We don't ask for your name, email, or phone number. Your handle ("Blue Panda") and all your posts, comments, votes, follows, and direct messages are wiped every day at midnight UTC. Tomorrow you are someone new and your social history is gone.
>
> We do assign each device a permanent internal identifier that we use to fight abuse and answer lawful legal process. We never show it to you or to other users.
>
> Direct messages are end-to-end encrypted. We hold only ciphertext. We cannot read them and cannot produce plaintext under any legal process.
>
> We temporarily log IP addresses and technical metadata for security, abuse prevention, and to comply with the law. We do not sell or share this data. Logs auto-delete after 14 days unless we are required to retain them for an active investigation.

## 8. Success metrics

* Daily active UIDs (DAU-UID)
* Posts per UID per day
* Report-to-action time
* False-positive moderation rate
* Server cost per DAU
* Rotation success rate (target: 100% of active devices rotated within 5 min of UTC midnight)

## 9. Anti-features (what we explicitly do *not* do)

* No "for you" personalization in v2
* No ads in v2
* No public counters (follower count, post count) on identities — these would re-introduce a persistent graph
* No notifications about who reacted to your post — only aggregate counts
* No global search of users — only content
* **No plaintext DMs. Ever.**
* **No cross-day social history of any kind.**
