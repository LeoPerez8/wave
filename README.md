# wave

Working environment for the `wave` project.

## Agent skills

This environment uses [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT),
installed as a **Claude Code plugin**. They are a managed, read-only bundle that updates
when upstream ships — the skill files are *not* vendored into this repo.

### Setup on a new machine

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
```

Then, once per repo, run `/setup-matt-pocock-skills` inside a session. It asks which issue
tracker to use (GitHub, Linear, or local files), which labels you apply when triaging, and
where generated docs should live.

### What's available

Alignment before you build — use these *first*:

| Skill | Use it to |
| --- | --- |
| `/grill-me` | Get grilled on what you actually want, before any code |
| `/grill-with-docs` | Same, plus research and a written spec |
| `/wayfinder` | Find your way around an unfamiliar codebase |
| `/research` | Investigate a question and write up the findings |

Turning intent into work:

| Skill | Use it to |
| --- | --- |
| `/to-spec` | Turn a conversation into a spec |
| `/to-tickets` | Break a spec into tickets |
| `/triage` | Label and sort incoming tickets |
| `/to-questionnaire` | Turn a topic into questions worth answering |

Building:

| Skill | Use it to |
| --- | --- |
| `/implement` | Work a ticket through to done |
| `/tdd` | Drive the change test-first |
| `/prototype` | Spike something throwaway to learn from |
| `/wizard` | Scaffold a guided multi-step flow |

Design and review:

| Skill | Use it to |
| --- | --- |
| `/domain-modeling` | Build a shared language for the domain |
| `/codebase-design` | Shape module and file structure |
| `/improve-codebase-architecture` | Find and fix architectural drift |
| `/code-review` | Review a change |
| `/diagnosing-bugs` | Track a bug to its root cause |
| `/resolving-merge-conflicts` | Work through a conflicted merge |

Communication:

| Skill | Use it to |
| --- | --- |
| `/handoff` | Hand work off with enough context to continue |
| `/teach` | Have a concept explained properly |
| `/wait-what` | Flag something surprising and dig in |
| `/writing-for-agents` | Write docs an agent can actually use |
| `/ask-matt` | Ask what Matt would do here |

## Environment

- Node 20.11.1, npm 10.2.4, pnpm 9.0.6
- git 2.42.0, GitHub CLI 2.100.0
