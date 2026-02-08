# ADR 0001: Student Overlay Model for Lesson Slides

## Status
Accepted

## Context
We let teachers create or import lesson slides, and students respond on top of those
slides. We need a clear model for how student work relates to the teacher's base
slide content.

We considered two options:
1. Live, two-way sync where teacher edits propagate into all student canvases.
2. A base scene owned by the teacher, with per-student overlays that do not mutate
   the base once students begin.

## Decision
We use a base + overlay model:
- The teacher scene JSON is the base.
- Each student's work is stored separately and references the base by ID/version.
- We do not do live merge between base and overlays.

We will store a `baseSceneId` or `sceneVersion` alongside student responses to
keep the option of future sync.

## Consequences
Pros:
- Simple and stable for live sessions.
- Avoids merge conflicts and surprise changes mid-work.
- Easier to reason about grading and review.

Cons:
- Teacher edits after students start do not automatically appear.
- Future live-sync would require a merge or rebase step.

## Future Option
If we need live sync later, we can implement:
- A "Push updates" action that rebases student overlays or starts a new version.
- A merge strategy that keeps student edits but updates base shapes.
