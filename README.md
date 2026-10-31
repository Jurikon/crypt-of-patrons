# Crypt of Patrons

Turn-based first-person roguelike for the browser. Design: [docs/GDD.md](docs/GDD.md). Milestones: [docs/ROADMAP.md](docs/ROADMAP.md). Rules for contributors (and Claude Code): [CLAUDE.md](CLAUDE.md).

**Preview:** https://jurikon.github.io/crypt-of-patrons/

## Develop

```bash
pnpm install
pnpm dev          # local server
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:smoke   # Playwright smoke test against the production build
pnpm rooms 1 5    # print generated rooms as ASCII
```

URL options: `#seed-42` fixes the seed, `#debug` opens the debug overlay (also toggled with the backquote key).
