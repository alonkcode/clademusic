---
title: Welcome to Clade
---

# 🎵 Clade Documentation

**Find Your Harmony**

Clade is a TikTok-style music discovery platform that analyzes songs by **harmonic structure**, not genre. Find tracks using chord progressions, cadence patterns, and relative theory.

## 🔖 Current Version

- Web: **1.0.1** (2026-02-04) — see [CHANGELOG.md](../CHANGELOG.md)

## 📚 Documentation

### Getting Started
- [Features](features.md) — Complete feature list with harmonic analysis
- [Tech Stack](tech-stack.md) — React 18, TypeScript, Vite, Supabase
- [Getting Started](getting-started.md) — Installation and setup
- [Usage Guide](usage.md) — How to use the app

### Development
- [Development Guide](development.md) — Local development workflow
- [Database Setup](DATABASE_SETUP.md) — Provisioning Supabase from empty, seeding, verification
- [Testing](testing.md) — Vitest and Cypress testing
- [Building for Production](build.md) — Production builds
- [Deployment](deployment.md) — GitHub Pages, Vercel, and base paths

### Architecture
- [Harmonic Analysis Architecture](HARMONIC_ANALYSIS_ARCHITECTURE.md) — **Core system design** (relative theory, hybrid pipeline, similarity engine)
- [Harmonic Loop](HARMONIC_LOOP.md) — Web Audio playback of progressions in any key
- [Architecture Summary](ARCHITECTURE_SUMMARY.md) — Quick reference for technical decisions

### Contributing
- [Contributing Guide](contributing.md) — How to contribute
- [FAQ](faq.md) — Common questions
- [License](license.md) — MIT License

### Reference
- [Changelog](../CHANGELOG.md) — Version history and recent changes
- [Tasks](../TASKS.md) — Current progress and roadmap
- [Release Process](RELEASE_PROCESS.md) — How versions/releases work
- [Code Review Checklist](CODE_REVIEW.md) — What to verify for every PR
- [Known Issues](KNOWN_ISSUES.md) — Operational notes + open bugs

---

## 🎯 Key Concepts

### Relative Theory-First
All harmonic data stored as **Roman numerals** (I-V-vi-IV), never absolute chords. Absolute keys derived only for display.

### Hybrid Analysis Pipeline
Cache-first approach → Async job queue → ML processing → Result storage. Non-blocking UI with provisional results.

### Similarity by Harmony
Tracks matched by: Progression shape (50%), Cadence (20%), Loop length (15%), Modal color (10%), Tempo (5%). Genre is a secondary signal.

---

If you have questions or need help, open an issue on [GitHub](https://github.com/kaospan/clademusic) or reach out to the maintainer.
