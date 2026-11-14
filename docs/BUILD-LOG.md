# Build log

One line per step, newest last.

- 2026-11-14: Repository skeleton: README, MIT license, AGENTS.md, the pre-code plan in `preparation/PLAN.md`.
- 2026-11-14: Entry registered for the event; the submission materials folder is set up locally and kept out of the repository.
- 2026-11-14: Code scaffold: config with validation, English and Malay text files, Fastify server with strict headers, front page skeleton, unit and browser tests, gate script, Dockerfile.
- 2026-11-14: Front page fits the phone first screen: shortened copyable address in the banner, compact mobile layout, 44 px touch targets, browser test checks the primary button is visible without scrolling.
- 2026-11-14: Test wallet key tool (secrets only in the ignored env file, addresses printed), single-container deploy with rollback and a browser check against the public URL, uptime watch.
- 2026-11-14: The Build with XO bounty work is started as a separate repository with its own build plan; this repository does not depend on it.
- 2026-11-14: Core swap pieces: pool v0 locking bytecode and arithmetic checked against cashlab on captured pools, swap transaction builder, VM verification with 2026 rules, browser-side transaction check (rules 1 to 5) with sabotage tests.
- 2026-11-14: Token categories in config are case-insensitive and lowercased on load; the pool fixture reads the PUSD category from config instead of repeating it.
