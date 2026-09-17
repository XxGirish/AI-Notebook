export const mockLessonProposal: unknown = {
  schemaVersion: 1,
  operations: [{
    type: "insert_lesson_section",
    localId: "force-review",
    anchor: { relation: "after_selection" },
    title: "Force and acceleration review",
    blocks: [
      {
        kind: "text",
        title: "Core idea",
        body: "A net force changes an object's velocity. With the same mass, a larger net force produces a larger acceleration.",
      },
      {
        kind: "equation",
        title: "Newton's second law",
        latex: "\\vec{F}_{net} = m\\vec{a}",
        explanation: "Acceleration points in the direction of the net force, while mass resists that change in motion.",
      },
      {
        kind: "diagram",
        title: "Cause and response",
        direction: "left_to_right",
        nodes: [
          { localId: "force", label: "Net force" },
          { localId: "mass", label: "Mass" },
          { localId: "acceleration", label: "Acceleration" },
        ],
        edges: [
          { from: "force", to: "acceleration", label: "increases" },
          { from: "mass", to: "acceleration", label: "reduces for same force" },
        ],
      },
      {
        kind: "quiz",
        prompt: "If net force stays constant while mass doubles, what happens to acceleration?",
        options: [
          { localId: "double", label: "It doubles" },
          { localId: "half", label: "It halves" },
          { localId: "same", label: "It stays the same" },
        ],
        correctOptionLocalId: "half",
        rationale: "From a = F/m, doubling mass while keeping force constant halves acceleration.",
        conceptTags: ["newtons-second-law", "proportional-reasoning"],
      },
    ],
  }],
};
