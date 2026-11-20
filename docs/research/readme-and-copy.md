# What a README is for, and how not to sound like a machine wrote it

Research for the README rewrite after 1.3.0. Two questions, both asked against
primary sources: what belongs in a README, and which habits make product copy
read as generated text. The rewrite that uses this is [README.md](../../README.md).

## 1. A README is a decision page, not a manual

GitHub: a README "should only contain information necessary for developers to
get started using and contributing to your project. Longer documentation is best
suited for wikis." Rendering is truncated past 500 KiB, so the top carries the
argument.

- [GitHub Docs — About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)

Google: a README is "a short summary" that "orients the new user to the
directory and points to more detailed explanation and user guides."

- [Google — READMEs](https://google.github.io/styleguide/docguide/READMEs.html)

Microsoft's order is introduction (with a screenshot and platform support) →
get started/install → build steps → contribute/license, and it says to move
complex setup out of the README and link to it.

- [Microsoft — Create a README file for your repo](https://learn.microsoft.com/en-us/azure/devops/repos/git/create-a-readme?view=azure-devops)

Johns Hopkins OSPO states the what/why split bluntly: "Describe your project in
terms of what it does or achieves - not how. This is not the place to talk about
languages, technologies or tools, that comes later."

- [JHU OSPO — README Basics](https://ospo.library.jhu.edu/wp-content/uploads/sites/60/2024/07/OSPO-Explainer_README-Basics-Transcript.pdf)

Diátaxis keeps explanation (how it works inside) separate from the how-to and
reference material a new user needs first; GitHub recommends Diátaxis for repo
docs.

- [Diátaxis — Explanation](https://diataxis.fr/explanation)
- [GitHub Blog — Documentation done right](https://github.blog/developer-skills/documentation-done-right-a-developers-guide/)

Art of README calls the required order "cognitive funneling": broad,
decision-relevant information first, then progressively narrower detail.

- [Art of README](https://github.com/noffle/art-of-readme)

### The order this implies

1. Name, one-line outcome, supported platforms.
2. A real screenshot, then two or three sentences of what it is.
3. Install and download, near the top.
4. First-run steps with an expected result.
5. The views and the differentiator.
6. Reference material (keys, flags, MCP tools).
7. Develop, license, credits.

### What to cut

Long FAQ, changelog, architecture internals and full API reference belong in
linked docs, not the README. Badge walls add visual noise; Art of README's test
is "what real value is this badge providing to the typical viewer?"

- [Art of README](https://github.com/noffle/art-of-readme)
- [Write the Docs — How to write software documentation](https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/)

### Screenshots and alt text

Microsoft asks for a screenshot in the introduction when a project has a UI.
Google says crop to the relevant part, keep it discrete, and never put text,
code or terminal output in an image. GitHub's docs style guide asks for alt text
of 40–150 characters that starts with the graphic type ("Screenshot of…").

- [Google — Images](https://developers.google.com/style/images)
- [GitHub Docs — Style guide](https://docs.github.com/en/contributing/style-guide-and-content-model/style-guide)

### What the evidence actually supports

Prana et al. annotated 4,226 README sections from 393 repositories and surveyed
20 professionals: "What" sections appear in 97.0% of files, "How" in 88.5%, but
"Why" (25.7%) and status (21.4%) are rare. Install, usage and prerequisites
dominate what readers say they expect. The sample is small and self-selected, so
treat it as directional.

- [Prana et al., Categorizing the Content of GitHub README Files](https://arxiv.org/html/1802.06997v2)

No primary source gives a word count, an above-the-fold rule, or evidence that
badges and GIFs increase adoption. The popularity studies are correlational.

- [Readme content and project popularity](https://arxiv.org/html/2206.10772v1)

## 2. Not sounding generated

Wikipedia's field guide is the most concrete list, and its diagnosis is the
useful part: the tell is a "distinct and easily identifiable repertoire" of
moves, not a single word. Its sharpest line for product copy: models replace
"specific, unusual, nuanced facts … with more generic, positive descriptions."

- [Wikipedia — Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

### Tells to remove

- **Vocabulary:** delve, deep dive, tapestry, landscape, testament, underscore,
  showcase, robust, seamless, pivotal, crucial, meticulous, intricate, foster,
  empower, leverage, elevate, unlock, harness, realm, journey, vibrant, boasts.
- **Significance inflation:** "stands as", "plays a key role", "marks a shift",
  "underscores the importance", "evolving landscape".
- **Copula avoidance:** "serves as / functions as / boasts" where "is / has"
  would do.
- **The `-ing` tail:** sentences ending in "…, ensuring…", "…, highlighting…",
  "…, reflecting…" where the clause adds no fact.
- **Rule of three:** three adjectives or three parallel clauses standing in for
  one supportable claim.
- **Negation framing:** "not just X, but Y", "more than a tool". Reported at
  roughly 3× human rate; it also does not work on readers, who remember the
  affirmed half and lose the negation.
- **Bold-lead-in vertical lists**, title-case headings and emoji bullets as
  structure.
- **Puffery:** revolutionary, cutting-edge, world-class, best-in-class.

Sources: [WP:AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
[WP:Words to watch](https://en.wikipedia.org/wiki/Wikipedia:Manual_of_Style/Words_to_watch),
[Gorrie, rhetorical analysis of LLM prose](https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai),
[The Conversation — negative parallelism](https://theconversation.com/slanguage-why-ais-stylistic-negation-its-not-x-its-y-is-both-annoying-and-doesnt-work-278967).

Two corrections worth keeping: em-dash frequency is no longer a reliable tell,
and stacked intensifiers ("very", "really") are a human marketing habit rather
than an LLM one. Cutting them is still right, for Strunk's reason.

### Rules that replace the tells

Orwell: never use a metaphor you are used to seeing in print; never a long word
where a short one will do; "if it is possible to cut a word out, always cut it
out"; active over passive.

- [Orwell — Politics and the English Language](https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language)

Strunk: "Omit needless words." And on hype: "A single overstatement, wherever or
however it occurs, diminishes the whole, and a single carefree superlative has
the power to destroy, for readers, the object of your enthusiasm."

- [Strunk & White, The Elements of Style](https://www.gutenberg.org/files/37134/37134-h/37134-h.htm)

GOV.UK's "words to avoid" is the best substitution table: deliver → make,
create, provide; facilitate → help; leverage → use; robust → well thought out;
key → important, usually cut. Rationale: "they do not say what you actually
mean and lead to slower comprehension."

- [GOV.UK — A to Z style guide](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide)
- [plainlanguage.gov — Use simple words and phrases](https://www.plainlanguage.gov/guidelines/words/use-simple-words-phrases/)

### The test applied to this README

1. Does the first two sentences contain a number, a name or a mechanism?
2. Does any sentence end in an `-ing` clause that adds no fact?
3. Is there a group of three? Keep only what is supportable.
4. Is there a superlative that cannot be documented?
5. Does a section repeat a claim made higher up? Cut one.

Cortex makes verifiable claims — 332 notes, 557 links, ~5,600-note synthetic stress test,
`~400 ms`, MIT, no telemetry, optional GitHub release-feed check (disable in Settings or with `--offline`) — so the copy should spend those instead
of adjectives.

## What could not be verified

- No official word count, section count or above-the-fold specification exists
  for READMEs. GitHub's only hard limit is the 500 KiB render ceiling.
- There is no public data on how far people scroll a README or which sections
  they open; GitHub traffic analytics is page-level and 14-day.
- No primary evidence that a screenshot, GIF or badge causes adoption.
- The reader-expectation survey is 20 self-selected professionals.
- Wikipedia's AI-vocabulary lists are era-specific and explicitly incomplete;
  they are directional, not a detector.
