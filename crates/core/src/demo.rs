//! Seeded demo vault: ~80 concept notes plus a two-year journal.
//!
//! The generator is deterministic: same day, same vault, same universe. It is
//! only ever additive and refuses to touch a non-empty folder unless the
//! `.cortex-demo` marker already proves the folder was generated here.

use std::fs;
use std::io::{Error, ErrorKind};
use std::path::Path;

use crate::dates;
use crate::store;
use crate::synthesis::{self, Evidence, Template};

const MARKER: &str = ".cortex-demo";

struct Seed {
    title: &'static str,
    folder: &'static str,
    tags: &'static [&'static str],
    lede: &'static str,
    points: &'static [&'static str],
    links: &'static [&'static str],
}

const CONCEPTS: &[Seed] = &[
    Seed {
        title: "Deep Work",
        folder: "Ideas",
        tags: &["focus", "craft"],
        lede: "The ability to concentrate without distraction on a cognitively demanding task is becoming rarer and more valuable at the same time.",
        points: &[
            "Depth is not a personality trait; it is a practice with a warm-up, a cost and a recovery period.",
            "Every deep session buys a little more capacity for the next one, which is why streaks matter more than marathons.",
        ],
        links: &["Attention Economy", "Flow States", "Cognitive Load", "The Cost of Context Switching"],
    },
    Seed {
        title: "Attention Economy",
        folder: "Ideas",
        tags: &["attention", "culture"],
        lede: "Attention is the scarce input of every other economy, and it is the only one you cannot borrow.",
        points: &[
            "Products compete for the moment before you decide what to do, not for the moment after.",
            "The design response is boring and effective: fewer surfaces, stronger defaults, and friction in front of the wrong thing.",
        ],
        links: &["Deep Work", "Interruption Debt", "Dopamine Loops", "Slow Media"],
    },
    Seed {
        title: "Flow States",
        folder: "Ideas",
        tags: &["psychology", "focus"],
        lede: "Flow arrives when difficulty and skill are close enough that neither self-consciousness nor boredom has room to appear.",
        points: &[
            "The state is fragile at the start and stubborn in the middle: the first ten minutes are the tax.",
            "Feedback has to be immediate to stay in it, which is why a visible draft beats a perfect outline.",
        ],
        links: &["Deep Work", "Cognitive Load", "Deliberate Practice", "Play"],
    },
    Seed {
        title: "Cognitive Load",
        folder: "Ideas",
        tags: &["psychology"],
        lede: "Working memory holds a handful of things at once; everything else is a queue pretending to be a thought.",
        points: &[
            "Writing things down is not a memory aid, it is a way of freeing the part of the mind that holds context.",
            "Interfaces and notes both fail the same way: they make you carry state in your head.",
        ],
        links: &["Flow States", "Working Memory", "Spaced Repetition", "Second Brain"],
    },
    Seed {
        title: "Interruption Debt",
        folder: "Ideas",
        tags: &["systems", "attention"],
        lede: "Every interruption borrows against the next twenty minutes, and the interest compounds quietly.",
        points: &["The cost is not the reply; it is the reload of the mental model you had before the ping.",
            "Batching is a debt restructuring plan: same obligations, far less interest."],
        links: &["Attention Economy", "The Cost of Context Switching", "Deep Work"],
    },
    Seed {
        title: "The Cost of Context Switching",
        folder: "Ideas",
        tags: &["systems", "attention"],
        lede: "Switching tasks feels instant and costs minutes; the mind keeps a tab open for every unfinished thing.",
        points: &["Fewer open loops beat better multitasking every time.",
            "The practical rule: finish, park with a note, or do not start."],
        links: &["Interruption Debt", "Cognitive Load", "Attention Economy"],
    },
    Seed {
        title: "Second Brain",
        folder: "Ideas",
        tags: &["knowledge"],
        lede: "A second brain is useful only when it answers questions you did not know you would ask.",
        points: &["Capture is cheap; retrieval and trust are the expensive parts.",
            "A note you cannot find is a note you did not write."],
        links: &["Zettelkasten", "Progressive Summarization", "The Atlas", "Local First"],
    },
    Seed {
        title: "Zettelkasten",
        folder: "Ideas",
        tags: &["knowledge"],
        lede: "The slip-box works because it forces every idea to become a sentence with an address.",
        points: &["Links are arguments: two notes connected are a claim about how they relate.",
            "The value is in the neighbourhood, not in the individual card."],
        links: &["Second Brain", "Atomic Notes", "Link Rot"],
    },
    Seed {
        title: "Atomic Notes",
        folder: "Ideas",
        tags: &["knowledge", "writing"],
        lede: "One note, one claim. Anything larger is a document wearing a note's clothes.",
        points: &["Small notes get reused; large notes get admired once and forgotten.",
            "If a title needs an 'and', it is probably two notes."],
        links: &["Zettelkasten", "Writing to Think", "Note Titles as Claims"],
    },
    Seed {
        title: "Progressive Summarization",
        folder: "Ideas",
        tags: &["knowledge"],
        lede: "Compress in layers, and only compress what you have already needed twice.",
        points: &["Highlighting everything is a way of deciding nothing.",
            "The final layer is your own sentence, written without looking at the source."],
        links: &["Second Brain", "Atomic Notes", "Reading in Layers"],
    },
    Seed {
        title: "Slow Media",
        folder: "Ideas",
        tags: &["culture", "attention"],
        lede: "Some things are worth reading at the speed they were written.",
        points: &["A slower input changes the shape of the output, not just the quantity.",
            "Choosing fewer sources is a form of editing your own attention."],
        links: &["Attention Economy", "Reading in Layers", "Dopamine Loops"],
    },
    Seed {
        title: "Dopamine Loops",
        folder: "Ideas",
        tags: &["psychology"],
        lede: "The reward is in the anticipation, which is why the refresh gesture outlives the reason for it.",
        points: &["Variable rewards are sticky by design and corrosive by accumulation.",
            "Replace the loop rather than fighting it: give the same restlessness a better target."],
        links: &["Attention Economy", "Slow Media", "Habit Gravity"],
    },
    Seed {
        title: "Habit Gravity",
        folder: "Ideas",
        tags: &["psychology", "systems"],
        lede: "Habits are not decisions repeated; they are the path of least resistance wearing a groove.",
        points: &[
            "Change the environment and the habit changes without a fight.",
            "The loop that survives is the one that still works on a bad day.",
        ],
        links: &["Dopamine Loops", "Feedback Loops", "Constraints", "Deep Work"],
    },
    Seed {
        title: "Spaced Repetition",
        folder: "Research",
        tags: &["learning"],
        lede: "Forgetting is not the enemy of memory; it is the mechanism that makes remembering cheap.",
        points: &["Recall at the edge of forgetting is what builds durable access.",
            "Flashcards are a narrow tool; the principle applies to notes you revisit on a schedule."],
        links: &["Working Memory", "Cognitive Load", "Deliberate Practice"],
    },
    Seed {
        title: "Working Memory",
        folder: "Research",
        tags: &["psychology"],
        lede: "The mind holds roughly four chunks at once, and every one of them is rented.",
        points: &["External structure is not a crutch; it is an extension of the same system.",
            "Naming the thing you are holding is often enough to put it down."],
        links: &["Cognitive Load", "Spaced Repetition", "Chunking", "Spatial Memory"],
    },
    Seed {
        title: "Chunking",
        folder: "Research",
        tags: &["learning"],
        lede: "Expertise looks like speed but is mostly compression: larger units, fewer of them.",
        points: &["A chunk is a pattern with a name, and names are what make patterns portable.",
            "Notes should encode chunks, not transcripts."],
        links: &["Working Memory", "Deliberate Practice", "Expertise"],
    },
    Seed {
        title: "Deliberate Practice",
        folder: "Research",
        tags: &["learning"],
        lede: "Practice counts when it targets the edge of your ability and gives you a way to see the error.",
        points: &["Comfortable repetition is maintenance, not growth.",
            "A coach, a recording or a test can all supply the missing mirror."],
        links: &["Flow States", "Chunking", "Feedback Loops", "Expertise"],
    },
    Seed {
        title: "Feedback Loops",
        folder: "Research",
        tags: &["systems"],
        lede: "A system with no feedback is a belief with a schedule.",
        points: &["Fast, local feedback beats slow, global feedback almost every time.",
            "The loop you can see is the loop you can steer."],
        links: &["Deliberate Practice", "Systems Thinking", "Habit Gravity"],
    },
    Seed {
        title: "Systems Thinking",
        folder: "Research",
        tags: &["systems"],
        lede: "Structure produces behaviour; blaming the person inside the structure is usually a category error.",
        points: &["Stocks, flows and delays explain most of what looks like irrationality.",
            "Draw the loop before arguing about the node."],
        links: &["Feedback Loops", "Leverage Points", "Local First"],
    },
    Seed {
        title: "Leverage Points",
        folder: "Research",
        tags: &["systems"],
        lede: "Some places in a system move everything, and most of them are not where the numbers are.",
        points: &["Rules, goals and paradigms outrank parameters; changing a slider rarely changes the game.",
            "The highest leverage point is usually the question the system refuses to ask."],
        links: &["Systems Thinking", "Feedback Loops", "Constraints"],
    },
    Seed {
        title: "Constraints",
        folder: "Research",
        tags: &["craft"],
        lede: "A constraint is a decision made in advance, and that is why it makes the work easier.",
        points: &["Unlimited options are a tax on taste.",
            "The best constraints are visible enough to be shared and tight enough to bite."],
        links: &["Leverage Points", "Creativity", "Deep Work", "Taste"],
    },
    Seed {
        title: "Expertise",
        folder: "Research",
        tags: &["learning"],
        lede: "An expert is someone with a large library of cases and the judgment to know which one applies.",
        points: &["Pattern recognition is built from failures you survived, not facts you memorised.",
            "Explaining the exception is the test; reciting the rule is the entry fee."],
        links: &["Chunking", "Deliberate Practice", "Ten Thousand Hours"],
    },
    Seed {
        title: "Ten Thousand Hours",
        folder: "Research",
        tags: &["learning", "myth"],
        lede: "The number is a headline, not a law; the useful part is that volume without direction is just time.",
        points: &["Quality of practice, feedback and starting age explain far more variance.",
            "Useful as a question: how many focused hours has this actually had?"],
        links: &["Expertise", "Deliberate Practice", "Constraints"],
    },
    Seed {
        title: "Spatial Memory",
        folder: "Research",
        tags: &["psychology"],
        lede: "The mind remembers where things are far more reliably than what they were called.",
        points: &["Spatial arrangement is a compression scheme the brain already knows how to use.",
            "A map of your notes can carry meaning that a list cannot."],
        links: &["Layout as Memory", "Working Memory", "Graph Views"],
    },
    Seed {
        title: "Writing to Think",
        folder: "Craft",
        tags: &["writing"],
        lede: "Writing is not the record of thinking; it is the machine that produces it.",
        points: &["A sentence you cannot finish is an idea you have not finished.",
            "The first draft is a question, the second is an answer."],
        links: &["Atomic Notes", "Drafting", "Editing", "Note Titles as Claims"],
    },
    Seed {
        title: "Drafting",
        folder: "Craft",
        tags: &["writing"],
        lede: "A draft is allowed to be wrong; it is not allowed to be vague.",
        points: &["Momentum is a material: do not stop to polish what you may delete.",
            "Write the ending first if the middle refuses to move."],
        links: &["Writing to Think", "Editing", "Constraints"],
    },
    Seed {
        title: "Editing",
        folder: "Craft",
        tags: &["writing"],
        lede: "Editing is where the reader is invented, and then defended line by line.",
        points: &["Cut the sentence you are proudest of and see if the paragraph survives.",
            "Read it aloud; the ear catches what the eye forgives."],
        links: &["Drafting", "Constraints", "Taste"],
    },
    Seed {
        title: "Taste",
        folder: "Craft",
        tags: &["craft"],
        lede: "Taste is the ability to notice the difference before you can explain it.",
        points: &["It is trained by exposure and sharpened by making things badly in public.",
            "A good editor of your own work is a well-fed reader of other people's."],
        links: &["Editing", "Constraints", "Expertise"],
    },
    Seed {
        title: "Creativity",
        folder: "Craft",
        tags: &["craft"],
        lede: "New ideas are old ideas meeting in a room they have never shared.",
        points: &["Input variety matters more than output volume.",
            "Most creative blocks are missing constraints, not missing inspiration."],
        links: &["Constraints", "Taste", "Play", "Second Brain"],
    },
    Seed {
        title: "Play",
        folder: "Craft",
        tags: &["craft"],
        lede: "Play is practice that forgot to be useful, which is often when it becomes useful.",
        points: &["Lower stakes let you try the technique you are not yet good at.",
            "The best tools invite a little useless exploration."],
        links: &["Creativity", "Constraints", "Flow States"],
    },
    Seed {
        title: "Note Titles as Claims",
        folder: "Craft",
        tags: &["writing", "knowledge"],
        lede: "A title that makes a claim turns a note into a position you can argue with later.",
        points: &["'On Focus' is a topic; 'Focus is a warm-up, not a talent' is a note.",
            "Claims connect; topics only accumulate."],
        links: &["Atomic Notes", "Writing to Think", "Editing"],
    },
    Seed {
        title: "Link Rot",
        folder: "Craft",
        tags: &["knowledge", "entropy"],
        lede: "Links decay when the thing they point at changes its name.",
        points: &["Renaming a note is a schema migration; treat it like one.",
            "A graph view makes rot visible: orphaned stars are broken threads."],
        links: &["Zettelkasten", "Second Brain", "Digital Gardens"],
    },
    Seed {
        title: "Digital Gardens",
        folder: "Craft",
        tags: &["knowledge"],
        lede: "A garden is a public notebook that is allowed to be unfinished.",
        points: &["Working in the open changes the quality of the notes, not just the audience.",
            "Tending beats publishing: small, frequent, alive."],
        links: &["Link Rot", "Second Brain", "Slow Media", "Portability"],
    },
    Seed {
        title: "Reading in Layers",
        folder: "Craft",
        tags: &["reading"],
        lede: "Read the shape first, then the argument, then the sentences that carry it.",
        points: &["Most books can be read in three passes; few deserve a fourth.",
            "Notes taken during the first pass are usually about you, not the book."],
        links: &["Progressive Summarization", "Slow Media", "Spaced Repetition"],
    },
    Seed {
        title: "Local First",
        folder: "Systems",
        tags: &["software"],
        lede: "Software that works offline, owns its data and syncs when it can is software you can still use in ten years.",
        points: &["The network is an optimization, never a requirement.",
            "Local-first is a promise about failure modes, not a feature list."],
        links: &["Systems Thinking", "Plain Text", "Sync", "Portability"],
    },
    Seed {
        title: "Plain Text",
        folder: "Systems",
        tags: &["software"],
        lede: "Plain text is the only format that has never needed a migration.",
        points: &["Every app is a temporary lens over files that outlive it.",
            "The cost of plain text is structure you have to invent; the benefit is structure that survives."],
        links: &["Local First", "Digital Gardens", "Portability", "Versioning"],
    },
    Seed {
        title: "Sync",
        folder: "Systems",
        tags: &["software"],
        lede: "Synchronisation is the art of making concurrent edits look like a conversation.",
        points: &["Last-write-wins is a policy, not a truth; it silently deletes someone's afternoon.",
            "The cheapest sync is the one you do not need because the files are already there."],
        links: &["Local First", "Plain Text", "Conflict", "Versioning"],
    },
    Seed {
        title: "Conflict",
        folder: "Systems",
        tags: &["software"],
        lede: "A merge conflict is an honest disagreement that the interface has finally admitted.",
        points: &["Conflicts are cheap when edits are small and expensive when they are structural.",
            "A conflict you cannot see is worse than one you can."],
        links: &["Sync", "Local First", "Versioning"],
    },
    Seed {
        title: "Versioning",
        folder: "Systems",
        tags: &["software"],
        lede: "History is a feature: the ability to see what you believed last month is a kind of memory.",
        points: &["Commits are notes about notes, and they age better than either.",
            "If the history is not readable, it is not really there."],
        links: &["Conflict", "Sync", "Plain Text"],
    },
    Seed {
        title: "Graph Views",
        folder: "Systems",
        tags: &["software", "visualization"],
        lede: "A graph view is a map of your own attention, which is why it is so easy to lose an hour in.",
        points: &["Force layouts reveal clusters; they do not reveal importance unless size says so.",
            "A graph is a reading aid, not an argument: the links were made by you."],
        links: &["The Atlas", "Second Brain", "Layout as Memory", "Spatial Memory"],
    },
    Seed {
        title: "Layout as Memory",
        folder: "Systems",
        tags: &["software", "visualization"],
        lede: "Stable positions turn a diagram into a place, and places are easier to remember than lists.",
        points: &["Deterministic layout means the map does not rearrange itself every time you open it.",
            "Grouping by folder makes the map legible before you read a single title."],
        links: &["Spatial Memory", "Graph Views", "The Atlas"],
    },
    Seed {
        title: "Portability",
        folder: "Systems",
        tags: &["software"],
        lede: "A tool earns trust by making it easy to leave.",
        points: &["Export is a product feature, not a compliance checkbox.",
            "The files are the app; everything else is a view."],
        links: &["Plain Text", "Local First", "Digital Gardens"],
    },
    Seed {
        title: "Sleep as Editing",
        folder: "Ideas",
        tags: &["psychology", "memory"],
        lede: "The night shift does the filing you skipped: sleep consolidates and prunes what the day left open.",
        points: &[
            "A late night buys hours at the cost of the editing that would have made them durable.",
            "The problem you cannot solve at 1am is often solved by 7am without a single new idea.",
        ],
        links: &["Working Memory", "Spaced Repetition", "Deep Work"],
    },
    Seed {
        title: "The Two-Hour Rule",
        folder: "Ideas",
        tags: &["focus", "craft"],
        lede: "Most genuinely hard work fits in two focused hours; the rest of the day is maintenance, meetings and taste.",
        points: &[
            "The rule is a ceiling on the false promise of a long day, not a target for an easy one.",
            "Protecting those two hours matters more than filling the other six.",
        ],
        links: &["Deep Work", "Attention Economy", "Constraints"],
    },
    Seed {
        title: "Boredom Is an Input",
        folder: "Ideas",
        tags: &["psychology", "attention"],
        lede: "Boredom is the signal that a task has stopped needing you, and the space where the next idea arrives.",
        points: &[
            "Removing every gap removes the incubation the gaps were for.",
            "The phone does not cure boredom; it spends the attention that boredom was freeing.",
        ],
        links: &["Dopamine Loops", "Slow Media", "Creativity"],
    },
    Seed {
        title: "Envy as a Compass",
        folder: "Ideas",
        tags: &["psychology", "craft"],
        lede: "Envy is accurate about what you want and dishonest about what it would cost.",
        points: &[
            "Use it as a question, not a verdict: what exactly do they have that I am not building?",
            "Admiration points outward; envy points at the gap between taste and output.",
        ],
        links: &["Taste", "Expertise", "Writing to Think"],
    },
    Seed {
        title: "Default Bias",
        folder: "Ideas",
        tags: &["systems", "psychology"],
        lede: "Whatever happens without a decision becomes the decision.",
        points: &[
            "Defaults are the cheapest policy a system can install, and the hardest to notice.",
            "Audit the things you do because they were already selected.",
        ],
        links: &["Habit Gravity", "Constraints", "Systems Thinking"],
    },
    Seed {
        title: "The Readiness Trap",
        folder: "Ideas",
        tags: &["focus", "psychology"],
        lede: "Waiting to feel ready is a way of scheduling the work for someone you are not yet.",
        points: &[
            "Competence arrives during the attempt, not before it.",
            "The first version is a tool for becoming the person who can make the second.",
        ],
        links: &["Perfect Conditions Fallacy", "Drafting", "Play"],
    },
    Seed {
        title: "Perfect Conditions Fallacy",
        folder: "Ideas",
        tags: &["psychology", "craft"],
        lede: "The perfect setup is a story about why the work has not started.",
        points: &[
            "A tool that removes one obstacle will reveal the next one, because the obstacle was never the point.",
            "Start where you are; the conditions improve as a side effect of the work.",
        ],
        links: &["The Readiness Trap", "Drafting", "Habit Gravity"],
    },
    Seed {
        title: "Identity Before Habit",
        folder: "Ideas",
        tags: &["psychology", "systems"],
        lede: "Behaviour that agrees with who you think you are survives a bad week; behaviour that contradicts it does not.",
        points: &[
            "Change the sentence you tell yourself first, and the actions have somewhere to attach.",
            "Small proof beats a new plan.",
        ],
        links: &["Habit Gravity", "Constraints", "Deep Work"],
    },
    Seed {
        title: "Memory Consolidation",
        folder: "Research",
        tags: &["learning", "memory"],
        lede: "Memories are not stored once; they are rebuilt, and sleep is the workshop.",
        points: &[
            "The same material replayed with a different cue becomes a different, more useful memory.",
            "Spacing works partly because each recall forces a fresh reconstruction.",
        ],
        links: &["Sleep as Editing", "Spaced Repetition", "Working Memory"],
    },
    Seed {
        title: "Interleaving",
        folder: "Research",
        tags: &["learning"],
        lede: "Practising related skills in mixed order feels worse and tests better.",
        points: &[
            "Blocked practice builds fluency inside one pattern; interleaving builds the choice between patterns.",
            "The discomfort is the discrimination being trained.",
        ],
        links: &["Deliberate Practice", "Spaced Repetition", "Chunking"],
    },
    Seed {
        title: "Testing Effect",
        folder: "Research",
        tags: &["learning"],
        lede: "Retrieval is not a measurement of learning; it is a cause of it.",
        points: &[
            "A test taken too early is still worth more than rereading the same page.",
            "Feedback after the attempt is what turns a guess into a memory.",
        ],
        links: &["Spaced Repetition", "Feedback Loops", "Expertise"],
    },
    Seed {
        title: "Cognitive Offloading",
        folder: "Research",
        tags: &["psychology", "knowledge"],
        lede: "Moving a fact out of your head and into the world is not cheating the mind; it is using it correctly.",
        points: &[
            "The question is whether the external trace is reliable and easy to find.",
            "Offload the state, keep the judgment.",
        ],
        links: &["Working Memory", "Second Brain", "Spatial Memory"],
    },
    Seed {
        title: "Attention Residue",
        folder: "Research",
        tags: &["attention", "psychology"],
        lede: "Part of the mind stays on the last task long after the switch, and that part is not available for the next one.",
        points: &[
            "The residue is why a five-minute check costs more than five minutes.",
            "A closing ritual is cheaper than trying to remember to stop.",
        ],
        links: &["Interruption Debt", "The Cost of Context Switching", "Deep Work"],
    },
    Seed {
        title: "Zeigarnik Effect",
        folder: "Research",
        tags: &["psychology", "systems"],
        lede: "Unfinished tasks keep returning to mind; finished ones let go.",
        points: &[
            "Writing the next step down can satisfy the loop without finishing the task.",
            "The effect is a feature of memory, not a flaw of character.",
        ],
        links: &["Interruption Debt", "Working Memory", "Task Capture"],
    },
    Seed {
        title: "Task Capture",
        folder: "Research",
        tags: &["systems", "knowledge"],
        lede: "A task is only off your mind when it is written somewhere you trust.",
        points: &[
            "An inbox you do not review is a second job.",
            "Capture is cheap; the trust that makes it work is built by review.",
        ],
        links: &["Second Brain", "Zeigarnik Effect", "Cognitive Offloading"],
    },
    Seed {
        title: "Diminishing Returns",
        folder: "Research",
        tags: &["systems", "learning"],
        lede: "Every method has a point where more of it stops helping, and the interesting question is where.",
        points: &[
            "The last ten percent of practice often costs more than the first sixty.",
            "Knowing the curve lets you spend the next hour elsewhere.",
        ],
        links: &["Ten Thousand Hours", "Constraints", "Leverage Points"],
    },
    Seed {
        title: "Voice",
        folder: "Craft",
        tags: &["writing", "craft"],
        lede: "Voice is the shape your sentences take when you are not trying to sound like anyone.",
        points: &[
            "It is built by reading widely and then writing without the sources in front of you.",
            "Consistency matters more than beauty: a recognizable sentence beats a perfect one.",
        ],
        links: &["Writing to Think", "Editing", "Taste"],
    },
    Seed {
        title: "Structure Before Prose",
        folder: "Craft",
        tags: &["writing"],
        lede: "Work out what the reader needs in what order before you make any of it pretty.",
        points: &[
            "An outline is a promise about sequence, not a list of topics.",
            "If the structure is wrong, better sentences only make the wrongness clearer.",
        ],
        links: &["Drafting", "Editing", "Outline as Instrument"],
    },
    Seed {
        title: "Outline as Instrument",
        folder: "Craft",
        tags: &["writing"],
        lede: "An outline is not a cage; it is the instrument you use to test whether the argument has a shape.",
        points: &[
            "Move the headings around before you move the paragraphs.",
            "The outline you cannot write is the part you have not thought through.",
        ],
        links: &["Drafting", "Structure Before Prose", "Constraints"],
    },
    Seed {
        title: "Revision Is Discovery",
        folder: "Craft",
        tags: &["writing", "craft"],
        lede: "You do not revise what you meant; you find out what you meant by revising.",
        points: &[
            "The second draft is where the argument becomes visible to its own author.",
            "Cutting is not loss when the thing removed was hiding the thing kept.",
        ],
        links: &["Editing", "Writing to Think", "Drafting"],
    },
    Seed {
        title: "Reading Aloud",
        folder: "Craft",
        tags: &["writing"],
        lede: "The ear catches the sentence the eye has learned to forgive.",
        points: &[
            "Read it aloud and the place you stumble is the place the reader will.",
            "Rhythm is part of meaning; a sentence that trips carries the wrong idea.",
        ],
        links: &["Editing", "Voice", "Reading in Layers"],
    },
    Seed {
        title: "The One-Sentence Summary",
        folder: "Craft",
        tags: &["writing", "knowledge"],
        lede: "If you cannot say it in one sentence, you have a topic rather than a note.",
        points: &[
            "The sentence is the claim; everything else is support or decoration.",
            "Write the summary first and the outline becomes obvious.",
        ],
        links: &["Note Titles as Claims", "Editing", "Atomic Notes"],
    },
    Seed {
        title: "Latency Budgets",
        folder: "Systems",
        tags: &["software", "systems"],
        lede: "A speed target is a design constraint, not a wish; it decides what the architecture is allowed to do.",
        points: &[
            "Every network hop and every disk flush spends from the same budget.",
            "Measure the budget where the user feels it, not where the code looks fast.",
        ],
        links: &["Feedback Loops", "Local First", "Sync"],
    },
    Seed {
        title: "Idempotence",
        folder: "Systems",
        tags: &["software"],
        lede: "An operation you can safely repeat is an operation you can safely retry.",
        points: &[
            "Retries turn a rare failure into a routine one, which is why the operation has to tolerate them.",
            "The cheapest distributed-systems repair is usually a request that does not care how many times it arrives.",
        ],
        links: &["Sync", "Conflict", "Versioning"],
    },
    Seed {
        title: "Backpressure",
        folder: "Systems",
        tags: &["software", "systems"],
        lede: "A system that cannot slow its input will eventually be slowed by its failure.",
        points: &[
            "Queues hide overload until the queue is the problem.",
            "Saying no early is kinder than timing out late.",
        ],
        links: &["Systems Thinking", "Feedback Loops", "Latency Budgets"],
    },
    Seed {
        title: "Observability",
        folder: "Systems",
        tags: &["software", "systems"],
        lede: "You cannot debug what you did not keep, and logs are cheaper than guesses.",
        points: &[
            "The useful question is not 'is it up' but 'what is it doing, and for whom'.",
            "Instrument the boundary: inputs, outputs, latency and error counts.",
        ],
        links: &["Feedback Loops", "Backpressure", "Graph Views"],
    },
    Seed {
        title: "The Smallest Viable Schema",
        folder: "Systems",
        tags: &["software", "knowledge"],
        lede: "Every field you add is a promise to keep it filled forever.",
        points: &[
            "A schema earns its complexity by removing more ambiguity than it creates.",
            "Frontmatter should hold what you query, not everything you know.",
        ],
        links: &["Plain Text", "Local First", "Portability"],
    },
    Seed {
        title: "Data Gravity",
        folder: "Systems",
        tags: &["software", "systems"],
        lede: "Data pulls the tools toward it; the format that stays put wins.",
        points: &[
            "Migration cost is the moat every file format actually has.",
            "Owning the files is a way of choosing where the gravity points.",
        ],
        links: &["Local First", "Portability", "Sync"],
    },
    Seed {
        title: "Filesystem as API",
        folder: "Systems",
        tags: &["software"],
        lede: "A folder is an interface everyone already has a client for.",
        points: &[
            "Reading and writing files is a contract older than any SDK.",
            "The constraints of the filesystem are a feature: paths, names, and nothing hidden.",
        ],
        links: &["Plain Text", "Local First", "Versioning"],
    },
    Seed {
        title: "Graceful Degradation",
        folder: "Systems",
        tags: &["software", "systems"],
        lede: "The mark of durable software is what still works when the network, the server or the sync is gone.",
        points: &[
            "Design the failure mode before the success mode, because the failure mode is what users keep.",
            "Offline is not a feature to add later; it is a decision about where the truth lives.",
        ],
        links: &["Local First", "Systems Thinking", "Portability"],
    },
    // Two worked examples of the structure notes Cortex can generate.
    Seed {
        title: "Research — Attention and Depth",
        folder: "Synthesis",
        tags: &["research", "synthesis"],
        lede: "A working answer: deep work is less about willpower than about how many open loops the environment keeps alive.",
        points: &["The sources agree that interruptions cost more than their duration; they disagree on whether the fix is individual or structural.",
            "The useful test for any change: does it reduce the number of things a person must hold in mind at once?"],
        links: &["Deep Work", "Attention Economy", "Interruption Debt", "Cognitive Load", "Constraints"],
    },
    Seed {
        title: "Decision — One Graph, Many Lenses",
        folder: "Synthesis",
        tags: &["idea", "decision"],
        lede: "One source of truth, several lenses: the universe, the brain and the focused local graph are renderings of the same notes, not separate products.",
        points: &["A second canvas drifts from the vault; a lens cannot.",
            "The risk is a hairball, so the answer is focus and filters, not more views."],
        links: &["Graph Views", "Layout as Memory", "Spatial Memory", "Second Brain", "Local First"],
    },
];

const MAPS: &[Seed] = &[
    Seed {
        title: "Start Here",
        folder: "Maps",
        tags: &["map"],
        lede: "This vault is a demo of Cortex: more than eighty linked notes and two years of journal, all plain Markdown.",
        points: &["Press ⌘K to search, click a star to read, drag to orbit.",
            "Everything here was generated by the Rust binary and then read back like any other vault."],
        links: &["The Atlas", "Graph Views", "Second Brain"],
    },
    Seed {
        title: "The Atlas",
        folder: "Maps",
        tags: &["map", "hub"],
        lede: "The twelve notes that the rest of the vault keeps returning to.",
        points: &["Start with the idea that sounds most like a question you are already asking.",
            "Each of these has its own cluster; the lines between them are the interesting part."],
        links: &[
            "Deep Work",
            "Attention Economy",
            "Second Brain",
            "Zettelkasten",
            "Spaced Repetition",
            "Systems Thinking",
            "Writing to Think",
            "Constraints",
            "Local First",
            "Graph Views",
            "Spatial Memory",
            "Slow Media",
        ],
    },
    Seed {
        title: "Focus Map",
        folder: "Maps",
        tags: &["map"],
        lede: "Everything I have written about protecting attention long enough to finish something.",
        points: &["The cluster has one hub and several debts: interruption, context switching, dopamine.",
            "The practical notes are the ones about starting, not the ones about discipline."],
        links: &[
            "Deep Work",
            "Attention Economy",
            "Flow States",
            "Interruption Debt",
            "The Cost of Context Switching",
            "Dopamine Loops",
            "Slow Media",
            "Cognitive Load",
        ],
    },
    Seed {
        title: "Learning Map",
        folder: "Maps",
        tags: &["map"],
        lede: "How memory actually behaves, and what that implies for practice.",
        points: &["The through-line is compression: chunks, spacing, feedback.",
            "Ten Thousand Hours is here as a warning, not a target."],
        links: &[
            "Spaced Repetition",
            "Working Memory",
            "Chunking",
            "Deliberate Practice",
            "Expertise",
            "Ten Thousand Hours",
            "Feedback Loops",
            "Cognitive Load",
        ],
    },
    Seed {
        title: "Writing Map",
        folder: "Maps",
        tags: &["map"],
        lede: "Notes on turning a vague feeling into a sentence someone else can use.",
        points: &["Drafting and editing are different jobs and should never share an hour.",
            "Taste is the part that improves by reading, not by writing."],
        links: &[
            "Writing to Think",
            "Drafting",
            "Editing",
            "Taste",
            "Constraints",
            "Creativity",
            "Play",
            "Note Titles as Claims",
            "Atomic Notes",
        ],
    },
    Seed {
        title: "Systems Map",
        folder: "Maps",
        tags: &["map"],
        lede: "Software and thinking structures that survive contact with failure.",
        points: &["Local-first is the spine; plain text is the reason it can exist.",
            "Conflict and versioning are the same problem seen from two ends."],
        links: &[
            "Systems Thinking",
            "Leverage Points",
            "Feedback Loops",
            "Constraints",
            "Local First",
            "Plain Text",
            "Sync",
            "Conflict",
            "Versioning",
            "Portability",
        ],
    },
    Seed {
        title: "Reading Map",
        folder: "Maps",
        tags: &["map"],
        lede: "How to read more slowly and remember more of it.",
        points: &["Progressive summarization is the method; slow media is the posture.",
            "A digital garden is what happens when the notes stop being private."],
        links: &[
            "Reading in Layers",
            "Progressive Summarization",
            "Slow Media",
            "Digital Gardens",
            "Link Rot",
            "Zettelkasten",
        ],
    },
    Seed {
        title: "Open Questions",
        folder: "Maps",
        tags: &["map", "questions"],
        lede: "The questions this vault keeps asking without quite answering.",
        points: &["Which of these is a real question and which is a nice sentence?",
            "Revisit monthly; delete the ones that stopped being interesting."],
        links: &[
            "Graph Views",
            "Layout as Memory",
            "Taste",
            "Expertise",
            "Slow Media",
            "Deep Work",
            "Portability",
            "Link Rot",
        ],
    },
];

const MORNING: &[&str] = &[
    "What deserves my attention before the day gets loud?",
    "Which note did I avoid writing, and why?",
    "What did I learn that I could teach in one sentence?",
    "Where did the time actually go yesterday?",
    "What is one thing I can remove today?",
    "What am I pretending not to know?",
    "Which idea keeps returning, and what is it asking for?",
    "What would make today feel finished?",
    "What did I read that changed a belief, even slightly?",
    "What is the smallest next step on the thing that matters?",
    "What was beautiful yesterday?",
    "Who would understand this better than me?",
];

const EVENING: &[&str] = &[
    "The morning went to messages; the afternoon went to the work I actually care about.",
    "It is much easier to think once the phone is in another room.",
    "Read for an hour without a screen and the ideas arranged themselves.",
    "The hard part was starting, as usual.",
    "Said no to a meeting and the day opened up.",
    "The draft is worse than I hoped and better than nothing.",
    "Walked without headphones and solved the problem I had been circling.",
    "Wrote a bad paragraph on purpose and the next one was fine.",
    "Everything took longer, but the result is honest.",
    "Found an old note that answered today's question.",
    "The graph is getting dense in the places I keep thinking about.",
    "Ended early. The work will still be there tomorrow.",
];

/// Writes the demo vault. Returns the number of Markdown files written.
pub fn seed(root: &Path, force: bool) -> std::io::Result<usize> {
    fs::create_dir_all(root)?;
    let marker = root.join(MARKER);
    let non_empty = fs::read_dir(root)?.next().is_some();
    if non_empty && !marker.exists() && !force {
        return Err(Error::new(
            ErrorKind::AlreadyExists,
            "refusing to write into a non-empty folder without --force",
        ));
    }
    fs::write(
        &marker,
        "Generated by `cortex seed-demo`. Safe to delete.\n",
    )?;

    let today = dates::today_days();
    let start = today - 730;
    let mut written = 0usize;

    for (index, seed) in CONCEPTS.iter().enumerate() {
        // Spread concepts over the first 60% of the timeline so the journal can
        // refer back to them during the replay.
        let created = start + ((index as i64 * 37) % 420) + 10;
        write_seed(root, seed, created, &mut written)?;
    }
    for (index, seed) in MAPS.iter().enumerate() {
        let created = start + 30 + (index as i64 * 21);
        write_seed(root, seed, created, &mut written)?;
    }

    // Two structure notes, so the decisions view has something to show on a
    // first run. They go through the same builder the app uses, so the demo
    // cannot drift from the frontmatter Cortex actually writes.
    let briefs: [(Template, &str, &[&str]); 2] = [
        (
            Template::Research,
            "How does attention shape deep work?",
            &[
                "Deep Work",
                "Attention Economy",
                "Interruption Debt",
                "Cognitive Load",
            ],
        ),
        (
            Template::Idea,
            "Should search come before the graph?",
            &["Second Brain", "Zettelkasten", "The Atlas"],
        ),
    ];
    for (template, question, titles) in briefs {
        let evidence = titles
            .iter()
            .map(|title| Evidence {
                title: (*title).to_string(),
                folder: "Ideas".to_string(),
                excerpt: String::new(),
            })
            .collect::<Vec<_>>();
        let body = synthesis::build(template, question, &evidence);
        let id = format!("Synthesis/{}", store::slugify(question));
        store::write_note(root, &id, &body).map_err(|err| Error::other(err.to_string()))?;
        written += 1;
    }

    let mut day = start;
    let mut entry = 0usize;
    while day <= today {
        let progress = (day - start) as f64 / (today - start).max(1) as f64;
        let date = dates::iso_date(day);
        let morning = MORNING[hash(entry as u64) as usize % MORNING.len()];
        let evening = EVENING[hash(entry as u64 ^ 0xA5) as usize % EVENING.len()];
        let mood = 2 + (hash(entry as u64 ^ 0x5C) % 4) as usize;

        // Early journals only know early concepts; later ones the whole atlas.
        let horizon = (CONCEPTS.len() as f64 * (0.15 + 0.85 * progress)) as usize;
        let first = &CONCEPTS[hash(entry as u64 ^ 0x11) as usize % horizon.max(1)];
        let links = format!("[[{}]]", first.title);

        let bar = "▮".repeat(mood) + &"▯".repeat(5 - mood);
        let body = format!(
            "---\ndate: {date}\ntags: [journal]\nmood: {mood}\n---\n\n# {date}\n\n**Morning.** {morning}\n\n**Evening.** {evening} This keeps pulling on {links}.\n\nMood: {bar}  \n"
        );
        let id = format!("Journal/{date}");
        store::write_note(root, &id, &body).map_err(|err| Error::other(err.to_string()))?;
        written += 1;
        entry += 1;
        // Every three days keeps the journal dense enough to fill a brain
        // without letting it swallow the concept notes.
        day += 3;
    }

    Ok(written)
}

fn write_seed(root: &Path, seed: &Seed, created: i64, written: &mut usize) -> std::io::Result<()> {
    let date = dates::iso_date(created);
    let tags = seed.tags.join(", ");
    let threads = seed
        .links
        .iter()
        .map(|link| format!("[[{link}]]"))
        .collect::<Vec<_>>()
        .join(", ");
    let paragraphs = seed
        .points
        .iter()
        .map(|point| point.to_string())
        .collect::<Vec<_>>()
        .join("\n\n");

    let body = format!(
        "---\ndate: {date}\ntags: [{tags}]\n---\n\n# {}\n\n{}\n\n{}\n\n## Threads\n\nPulled toward {threads}.\n",
        seed.title, seed.lede, paragraphs
    );
    let id = format!("{}/{}", seed.folder, seed.title);
    store::write_note(root, &id, &body).map_err(|err| Error::other(err.to_string()))?;
    *written += 1;
    Ok(())
}

fn hash(mut value: u64) -> u64 {
    value = value.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    value ^= value >> 31;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value.wrapping_mul(0x94D0_49BB_1331_11EB)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_a_connected_vault() {
        let dir = tempfile::tempdir().unwrap();
        let count = seed(dir.path(), false).unwrap();
        assert!(count > 300, "expected a rich demo, got {count}");
        assert!(dir.path().join(MARKER).exists());

        let vault = crate::Vault::load(dir.path(), "Demo", Default::default()).unwrap();
        assert!(vault.notes.len() > 300);
        assert!(vault.edges.len() > 500);
        assert!(vault.unresolved.is_empty(), "demo links must all resolve");
        let journal = vault.notes.iter().filter(|n| n.folder == "Journal").count();
        assert!(
            journal > 200,
            "journal should span the timeline, got {journal}"
        );
        assert!(vault.notes.iter().all(|n| !n.title.is_empty()));
        assert!(vault.notes.iter().any(|n| n.folder == "Maps"));
        let board = crate::structures::board(&vault);
        assert_eq!(board.total, 2, "the demo ships a brief and an idea");
        assert_eq!(board.open, 2);
        assert!(board.cards.iter().all(|card| !card.evidence.is_empty()));
    }

    #[test]
    fn is_deterministic_and_safe_to_rerun() {
        let dir = tempfile::tempdir().unwrap();
        seed(dir.path(), false).unwrap();
        let first = crate::Vault::load(dir.path(), "Demo", Default::default()).unwrap();
        seed(dir.path(), false).unwrap();
        let second = crate::Vault::load(dir.path(), "Demo", Default::default()).unwrap();
        assert_eq!(first.notes.len(), second.notes.len());
        assert_eq!(first.edges.len(), second.edges.len());
    }

    #[test]
    fn refuses_to_pollute_a_real_vault() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("important.md"), "keep me").unwrap();
        assert!(seed(dir.path(), false).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("important.md")).unwrap(),
            "keep me"
        );
        assert!(seed(dir.path(), true).is_ok());
    }
}
