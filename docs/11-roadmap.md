# 11 — Roadmap

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). The MVP/v1/v1.5/v2/v3 plan below targets the two-identifier identity model from day one. There is no "ship v1 identity first" stage — that approach was rejected.

## MVP (Weeks 0–8)

Goal: a single-room, text-only iOS + Android + web app with the two-ID identity model, posts, votes, comments, daily rotation, basic moderation.

* **Identity**: DID registration (one-per-device, 30d reservation), daily UID + password issuance
* **Daily rotation**: client-driven at UTC midnight, server fallback
* **Daily purge**: TTL reapers on `posts`, `votes`, `comments`
* One room: "Random"
* Post, comment, vote
* Hot + New feed
* WebSocket fan-out
* Rotation banner UI
* Basic report → manual review
* Abuse score on DID (sliding 0..100)
* iOS + Android + web, ship to TestFlight + Play internal
* Status page, basic Grafana
* Privacy policy + terms (incl. "DMs are E2E, we cannot read them")

## v1 (Weeks 8–18)

Goal: public launch in US + EU.

* All docs in this framework
* Multiple rooms + room subscription
* Media uploads with classifier
* PDQ hashing + NCMEC integration
* Shadow ban, weighted votes, brigading detection
* Admin console
* Trust & Safety hire
* Transparency report v1
* **DMs (E2E)**: thread list, message view, composer, key store in Keychain
* Background rotation task on iOS (`BGAppRefreshTask`) and Android (`WorkManager`)
* Bug bounty opens
* Marketing site + onboarding
* Public launch (Product Hunt, HN)

## v1.5 (Weeks 18–26)

* Appeal flow
* Display-name regeneration (per UID)
* Mute filters
* Encrypted at rest for media
* Biometric device key (iOS + Android)
* EU region active-active
* Push notifications (with the "messages disappear at midnight" copy)

## v2 (Weeks 26–40)

* Multi-region active-active
* GraphQL read-side
* Comments replies (1 level deep)
* Follows (same-day only — already specified)
* DLP upgrade: client-side screenshot detection on iOS & Android
* DSA trusted flagger program
* Yearly transparency report cadence
* DM group threads (E2E, ephemeral)

## v3 (Year 2+)

* ML-DSA alongside ECDSA (post-quantum)
* Localized moderation: in-region review teams
* Federated model (ActivityPub)? — *research only, not committed*
* Optional hardware-key login for power users (still respects daily rotation)