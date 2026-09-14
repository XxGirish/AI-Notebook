# 0001 — Select the Konva hybrid canvas architecture

Date: 2026-09-14  
Status: accepted

## Decision

Use Konva 10.5.0 with react-konva 18.2.16 and perfect-freehand 1.2.3 for canvas-rendered ink and spatial graphics. Render interactive learning objects such as equations and quizzes as trusted React HTML components aligned by the same world-coordinate camera.

Keep the engine-independent semantic notebook document as the sole authoritative representation. Konva nodes and React card positions are projections of that document and must not become competing persistence formats.

Excalidraw has been removed from the runtime and dependency tree. Reconsidering the engine requires a new explicit product decision with evidence.

## Evidence

- The initial shared fixture rendered pressure-bearing ink, a dedicated highlighter layer, ID-bound graph connectors, a KaTeX equation, an accessible quiz, and draggable HTML learning cards in the Konva hybrid.
- A browser smoke test created a completed pointer stroke, moved graph nodes while rerouting connectors, and graded the quiz locally.
- The Excalidraw spike supplied mature editor controls, but the initial semantic equation and quiz became ordinary labeled canvas shapes. The interactive embeddable and complete-export gates were not pursued after the user selected Konva.
- Removing Excalidraw eliminates its large editor bundle and the nine npm advisories then present in its transitive Mermaid/parser/nanoid dependency chain.

## Alternatives considered

- **Excalidraw:** lower initial editor effort, but custom interactive learning objects and complete semantic export remained unresolved in the spike.
- **Custom renderer from scratch:** rejected because Konva already provides a retained canvas scene graph, shapes, transforms, and input events.
- **tldraw:** not selected because the researched licensing model conflicts with straightforward unrestricted downstream self-hosting.

## Consequences and remaining work

The project owns more editor behavior: camera gestures, selection/lasso, whole-stroke erasing, grouping, bindings, history, accessibility coordination, culling, persistence, and all-layer export. The hybrid DOM/canvas stack must use one camera transform and an explicit interaction/layering policy.

Physical iPad/Pencil and Android stylus testing is still required. If browser handwriting quality fails on target hardware, reassess the web/native ink boundary rather than silently changing engines.
