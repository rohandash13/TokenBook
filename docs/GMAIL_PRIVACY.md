# Gmail demo and privacy answers

## What exists today

The Gmail lane uses six synthetic messages in `src/shared/demoEmails.ts`, with reserved `.example` addresses. TokenBook does not authenticate to Gmail, read a real inbox, send mail, or modify messages. The source label describes the planned provider; the UI explicitly labels this lane as a demo inbox.

Synthetic messages are scoped by team and month. Email extraction runs locally through the existing deterministic validator. Matching date/multiplier/window claims attach evidence to an existing event; repeated announcements do not multiply usage. Unknown sizes remain review flags. Existing lead/controller overrides are preserved.

The browser receives synthetic message bodies for the preview. Inferred evidence excerpts are stored in the local context store; raw refresh signals are cached in server memory. There is no automatic retention/deletion schedule. Closing the preview does not delete evidence. Existing variance memo prompts may contain derived financial context and stored evidence; local email extraction is not an end-to-end guarantee that all downstream email-derived data remains local.

Slack/GitHub model-backed extraction sends source text to Anthropic when configured. The prototype does not implement production authentication, organization isolation, encrypted token storage, or access auditing. Do not connect sensitive customer accounts to this prototype.

## Demo answer

“We are showing synthetic emails, not a personal inbox. Email extraction runs locally, and every driver shows its evidence. Slack/GitHub extraction can use Anthropic. Before supporting real customer mail, we need explicit account authorization, limited ingestion, access controls, retention/deletion, and clear model-processing consent.”

## Required before live Gmail

- Explicit Google OAuth authorization. Never ask for a Gmail password or reuse Codex's connected account as app authorization.
- Request only required permissions. `gmail.readonly` cannot send or modify messages, but it grants broad read access; filtering to an approved label is an application rule, not a narrower OAuth permission.
- Prefer a dedicated finance mailbox and approved labels/senders; fetch selected message bodies only. Exclude attachments and full thread histories by default.
- Encrypt refresh tokens, isolate organizations/teams, enforce server-side authorization on evidence and previews, and audit access without recording message bodies in logs.
- Specify retention, deletion on disconnect, backup expiry, and what derived records remain for accounting audit purposes. Do not claim deletion exists until implemented and tested.
- Offer local processing or separately authorized model processing with a documented list of fields/providers. Redaction alone does not guarantee anonymity. Confirm provider terms and applicable Google user-data requirements before launch; do not assert training or retention guarantees without evidence.
- Treat email bodies as untrusted data. Validate extracted dates, amounts and identities; never let embedded instructions change application policy or authorize bookings.
- Complete applicable Google verification/security review before external deployment.

Google references:
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
