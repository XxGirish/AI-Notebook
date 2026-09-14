# Canvas engine research for the AI Interactive Learning Notebook

Research date: **13 September 2026**. Sources below were accessed on that date. This memo evaluates the requirements in `idea.md`, including the later clarification that **desktop and tablet must both work from the start**. It is a desk-research recommendation, not a measured performance result or a completed hardware test.

## Recommendation

**Reuse an existing rendering/editor foundation. Do not build a raw Canvas/WebGL engine.** The difficult product work is the interaction between handwriting, editable learning objects, and AI actions. Reimplementing rendering, transforms, hit testing, and input dispatch would delay that work.

For a freely self-hostable open-source product, the strongest long-term candidate is **Konva + react-konva + perfect-freehand, with a controlled React DOM layer for learning cards**. This gives the project ownership of the document model and interaction rules with permissive dependencies. It is a *custom notebook editor built on libraries*, not a ready-made whiteboard. It carries substantial implementation work and should be selected only after a short hardware and integration spike.

**Excalidraw is the lower-effort challenger and fallback for a smaller first release.** It already has substantial whiteboard behavior, an MIT license, metadata, and a documented `renderEmbeddable` hook capable of returning React content. Test whether that hook can deliver the required MCQ/equation experience before rejecting it. If it passes, shipping a constrained Excalidraw-based notebook may be wiser than building an editor around Konva. If it requires a deep fork of selection, element rendering, or export internals, prefer the Konva design.

**tldraw is the best integrated technical fit but a poor default for unrestricted downstream self-hosting under its current license.** It is an excellent personal prototype option if the author accepts its licensing requirements. Treat that as an explicit product tradeoff, not a free open-source dependency.

The recommendation is conditional: choose the engine after the Phase 0 gates below. A stable, tablet-quality notebook with all the features listed in the proposed two-week MVP is not a credible two-week commitment, particularly on the Konva path.

## What is actually licensed

| Dependency | Verified upstream license / distribution distinction | Consequence for this project |
|---|---|---|
| tldraw SDK | Custom tldraw license; default permission is for development. Production requires a separate valid license. | Do not describe it as MIT or unrestricted open source. Publishing our own code does not remove downstream SDK obligations. |
| Excalidraw code/package | MIT. | Suitable permissive foundation; preserve required notices. The hosted application and Excalidraw+ services are separate from using the package. |
| Konva | MIT. | Suitable permissive renderer. |
| react-konva | MIT. | Suitable React integration. |
| perfect-freehand | MIT. | Suitable pressure-stroke algorithm. It is a separate package from the currently restricted tldraw SDK. |
| Fabric.js | MIT. | Suitable permissive foundation, with different interaction tradeoffs. |
| React Flow core | MIT. | Core is permissive, but some advanced example code is offered under separate Pro terms. |

Exact upstream license files: [tldraw](https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md), [Excalidraw](https://raw.githubusercontent.com/excalidraw/excalidraw/master/LICENSE), [Konva](https://raw.githubusercontent.com/konvajs/konva/master/LICENSE), [react-konva](https://raw.githubusercontent.com/konvajs/react-konva/master/LICENSE), [perfect-freehand](https://raw.githubusercontent.com/steveruizok/perfect-freehand/main/LICENSE), [Fabric.js](https://raw.githubusercontent.com/fabricjs/fabric.js/master/LICENSE). React Flow's maintainers distinguish the MIT core from paid content in their [open-source policy](https://xyflow.com/open-source).

The current tldraw guide describes a 100-day trial, commercial licenses, and discretionary hobby licenses for non-commercial projects. Hobby use requires a watermark. Production needs an active key; downstream users of an open-source project need their own applicable license. Keys validate on the client and can work offline. Do not assume a personal production application becomes development use merely because it runs locally. Recheck the selected package's actual license and any offered hobby agreement before committing. [tldraw licensing guide](https://tldraw.dev/community/license).

Do not confuse the free experience at tldraw.com with SDK distribution rights, or MIT-licensed demos with the SDK they import. The vendor explicitly distinguishes the [hosted app and SDK](https://tldraw.dev/faq). Likewise, Excalidraw's hosted collaboration and commercial AI services are not features that automatically appear by embedding its React package.

## Functional comparison

Ratings below are engineering judgments from the documented extension surfaces. They are not benchmarks.

| Requirement | tldraw SDK | Excalidraw package | Konva + React + freehand | Fabric.js | React Flow |
|---|---|---|---|---|---|
| Ready-made general editor | Strong | Strong | Must build editor UI and rules | Object editing primitives provided | Strong for nodes/edges |
| Pressure ink | Documented built-in | Existing freehand and pen handling | Capture pressure and use freehand algorithm | Brush layer; validate/add pressure behavior | Add custom ink subsystem |
| Lasso | Official custom-tool example | Present in current upstream tool types | Implement geometry and selection | Implement/test notebook lasso semantics | Official lasso example |
| Eraser/highlighter | Existing tools, inspect desired semantics | Eraser; notebook highlighter needs validation/configuration | Implement stroke eraser and highlight compositing | Eraser not a safe built-in assumption | Object eraser example; ink eraser custom |
| Interactive MCQ/equation cards | Natural custom React shapes | Embeddable renderer is possible; constrained element system | DOM layer plus canonical card records | Custom object or DOM overlay | Natural React nodes |
| Editable diagrams | Shapes plus bindings | Built-in shapes and arrow relationships | Build node/edge binding logic | Build node/edge binding logic | Core strength |
| Save/load | Store snapshots and migrations | Scene state + files + app metadata | Own versioned document format | Object serialization + custom properties | Own node/edge/document format |
| SVG/image export | Built-in pipeline, custom shape hooks | Built-in helpers; custom card fidelity must be tested | Raster native; custom semantic SVG/card compositor | Strong object/SVG export | DOM/image capture approach; custom print work |
| Open-source distribution friction | High under present SDK terms | Low | Low for named core dependencies | Low | Low for core; inspect Pro examples |
| Main cost | License and SDK coupling | Working within element/interaction model | Building notebook editor behavior | React/DOM integration and pen/gesture work | Turning diagram editor into handwriting notebook |

### tldraw: technically the most complete match

The SDK exposes shape utilities, geometry, schema properties, and custom React rendering. This suits a `quiz`, `equation`, `explanation`, or `flashcard` shape that users can move and resize. The official interactive-shape example demonstrates clickable UI. [Shape system](https://tldraw.dev/docs/shapes), [interactive shape](https://tldraw.dev/examples/interactive-shape).

Bindings are first-class relationships between shapes, so moving a concept node can update connected arrows. Custom bindings can represent more specialized relationships. Its persistence system supports snapshots and migration of custom records. These are meaningful advantages over a graphics renderer. [Bindings](https://tldraw.dev/sdk-features/bindings), [persistence](https://tldraw.dev/sdk-features/persistence).

The draw tool documents actual stylus pressure, simulated mouse pressure, freehand/straight segments, and stored point data. An official lasso example selects fully enclosed shapes; that is not partial stroke selection. Neither feature proves the experience on a specific iPad or Android tablet, nor does it promise native palm rejection. [Draw shape](https://tldraw.dev/sdk-features/draw-shape), [lasso example](https://tldraw.dev/examples/lasso-select-tool).

For custom cards, implement a deliberate export representation. The SDK can place HTML inside SVG `foreignObject`, but its own guidance recommends genuine SVG when portability matters. A quiz should export as a readable static question, with answer visibility chosen by the user. [Custom export](https://tldraw.dev/examples/toSvg-method-example), [image export pipeline](https://tldraw.dev/sdk-features/image-export).

The agent starter kit is worth studying even if this project chooses another engine. It separates gathered context, simplified shape formats, validated action utilities, and execution. It uses both structured objects and screenshots. Borrow the architecture: selected-object context, bounded actions, and a deterministic executor. Do not inherit unnecessary autonomous viewport changes, deletion powers, or unrestricted external API tools for the notebook MVP. [Agent starter kit](https://tldraw.dev/starter-kits/agent).

Remaining product work includes notebook navigation, lesson/card schemas, local quiz attempts, AI action validation, layout, provenance, undo grouping, exports, offline data durability, device testing, and licensing. The starter kit is not a completed learning notebook.

### Excalidraw: serious fast-start candidate, with constraints

Excalidraw exposes an imperative scene API, scene reads/updates, file access, and tool selection. Current upstream source includes `lasso`, `freedraw`, `eraser`, `hand`, and pen state. This establishes that saying it lacks lasso or pen handling would be inaccurate. Published stable versions can lag the default branch; validate the chosen release rather than copying current `master` APIs blindly. [Component API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api), [current source types](https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/types.ts).

The distinction that matters is **custom metadata versus custom element behavior**. `customData` can associate an element with a lesson or quiz. It does not by itself add new rendering, geometry, or click behavior. The upstream general custom-element proposal remains open. [Maintainer discussion of custom data](https://github.com/excalidraw/excalidraw/discussions/6429), [custom element proposal](https://github.com/excalidraw/excalidraw/issues/4957).

However, `renderEmbeddable(element, appState)` can replace the standard iframe renderer with React content. Therefore, an interactive quiz card may be possible without forking. In the spike, create an embeddable linked by application metadata to a typed quiz record, render trusted application components, and test activation, button clicks, keyboard focus, zoom, lasso, dragging, and serialization. The presence of this hook does **not** establish that HTML card content exports automatically. [Official render hook](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/render-props).

Basic AI diagrams can be built from ordinary elements and arrows while a separate semantic graph records conceptual relationships. Native diagrams can export as SVG or raster using official utilities. Store attached files alongside scene data, and export custom learning records in the notebook archive. [Element definitions](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts), [serialization utility](https://github.com/excalidraw/excalidraw/blob/master/dev-docs/docs/@excalidraw/excalidraw/api/utils/utils-intro.md), [export utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export).

Prefer this path if a usable first version can accept its visual style, whole-element operations, and embeddable card behavior. Reject it if core notebook features repeatedly require patching private editor internals. Maintaining a fork is a continuing cost, not a one-time shortcut.

### Konva + react-konva + perfect-freehand: best ownership, most editor work

Konva supplies the retained scene graph, shapes, transforms, events, and canvas rendering; react-konva supplies declarative React bindings. It runs in browser canvases, including a browser-based tablet app, but is not a React Native renderer. [React integration](https://konvajs.org/docs/react/index.html).

perfect-freehand converts sampled points into a pressure-sensitive stroke outline and leaves rendering to the application. Supply real pressure samples and disable pressure simulation for actual pen input; use simulated or constant pressure for unsupported devices. Keep source samples and style settings, not only a rasterized result. [Algorithm and pressure options](https://github.com/steveruizok/perfect-freehand).

Proposed implementation structure:

- One canonical document store with object IDs, spatial coordinates, order, semantic content, assets, and revisions.
- A camera transform shared by ink, shapes, selection overlay, and learning-card DOM.
- A temporary ink layer driven by pointer samples and animation frames; commit one completed stroke to persistent state on completion.
- Cached completed stroke geometry. Recompute when stroke/style changes, not every time an unrelated quiz answer changes.
- Standard scene objects for shapes, text, arrows, and images. A controlled DOM layer for rich text, equations, buttons, and focused editing.
- One selection and command system for all object types, so mixed selections move, duplicate, erase, and undo together.

Avoid copying the simplest free-drawing demo into production unchanged. Konva's own example warns that a React state list of hundreds or thousands of lines needs additional optimization. Start with isolated subscriptions, viewport culling, minimal interactive layers, and cached completed strokes; measure before adding complex batching. [Free drawing example](https://konvajs.org/docs/react/Free_Drawing.html), [performance guidance](https://konvajs.org/docs/performance/All_Performance_Tips.html).

Keep app data as the source of truth. Konva's persistence guide recommends serializing application state rather than relying on stage serialization for a complex app with images and events. This also allows an engine adapter without pretending that complete engine migration is free. [Serialization best practices](https://konvajs.org/docs/data_and_serialization/Best_Practices.html).

The HTML layer is a real risk to resolve early. `react-konva-utils` has an `Html` helper, but HTML overlays are not part of the canvas bitmap and are absent from normal canvas image exports. Konva also has no native SVG export. Build a card/static-text export compositor and a semantic SVG export path, or choose a clear first-release raster/print limitation. [DOM portal limitation](https://konvajs.org/docs/react/DOM_Portal.html), [Konva scope](https://konvajs.org/docs/guides/why-konva.html).

A practical initial stacking policy is **background → card surfaces → ink/annotations → interaction handles**. Put input controls above ink only while a card is focused; outside focus, render the card's static display and let pen input reach ink. If arbitrary interleaving of DOM cards and strokes is required, this architecture becomes more complicated. Test it before promising unlimited object ordering.

Custom work remains: gesture state machine, camera controls, object and stroke hit testing, lasso, eraser rules, pressure sampling, highlighter compositing, undo/redo, text editing, clipboard, grouping, connector attachment/routing, asset loading, migrations, exports, selection accessibility, and responsive toolbars. Those are the price of control. Do not estimate this as merely installing three packages.

### Fabric.js: capable object editor, weaker fit here

Fabric provides interactive object controls, text, free drawing, subclassing/custom properties, and serialization. It can reduce selection/transform work compared with Konva, and SVG export is a real advantage. [Core concepts](https://fabricjs.com/docs/core-concepts/), [custom properties](https://fabricjs.com/docs/using-custom-properties/), [Canvas API including SVG export](https://fabricjs.com/api/classes/canvas/).

Its custom controls are canvas controls rather than a general React learning-card system. Rich interactive content would still need an overlay or custom implementation. [Custom controls](https://fabricjs.com/demos/custom-controls/).

Do not cite the old Fabric 5 eraser demo as proof that a modern package ships that feature. The maintainer's Fabric 6 changes state that the eraser was extracted to another project and that touch gestures were not yet officially supported in that migration. That is historical migration evidence, so verify the exact selected modern release and any external eraser package before deciding. For this tablet-first evaluation, Fabric is a reserve candidate rather than the lead. [Maintainer breaking changes](https://github.com/fabricjs/fabric.js/issues/8299), [old eraser demo](https://fabric5.fabricjs.com/erasing).

### React Flow: a diagram subsystem or an alternative product emphasis

React Flow is excellent when most content is interactive nodes with handles and edges. Custom nodes are React components, making MCQs, forms, and equations straightforward. The core supplies selection, drag, zoom, and pan. [Custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [core product scope](https://reactflow.dev/).

It is possible to add ink: the official whiteboard collection includes a lasso example and a freehand example using perfect-freehand. The freehand example is specifically Pro-licensed; do not copy it into a permissive repository on the assumption that all React Flow examples are MIT. [Lasso](https://reactflow.dev/examples/whiteboard/lasso-selection), [freehand example and license](https://reactflow.dev/examples/whiteboard/freehand-draw).

The assessment is about fit, not impossibility: treating every handwriting stroke as a node does not remove pressure, eraser, touch, performance, and annotation work. Use React Flow as the main engine if the product becomes a concept-map/workflow tutor with occasional annotations. Avoid combining a full React Flow viewport and another independent whiteboard viewport in the MVP; keeping their camera, selection, history, and exports synchronized adds another system to maintain.

## Input contract for desktop and tablet

The application must define behavior before comparing libraries:

| Interaction | Proposed initial rule |
|---|---|
| Pen | Draw with pressure if present; constant-width setting available |
| Finger while pen mode is active | Pan/navigation; never create accidental ink |
| Two fingers | Pan/pinch using one gesture controller; test interruption during pen stroke |
| Mouse | Current tool; explicit hand tool and conventional desktop navigation |
| Eraser | Whole-stroke/object eraser first, with a visible toolbar control on every device |
| Lasso | Select complete objects/strokes that intersect or lie inside the lasso; crossing a stroke selects the entire stroke. Treat this as an explicit implementation choice to validate in the engine spike. |
| Quiz tap | Answer while card is active; selecting/moving the card uses a handle or explicit edit mode |
| Keyboard focus | Typing in a card must not trigger canvas shortcuts |

Pressure, tilt, pen buttons, coalesced samples, and pointer cancellation are exposed through the Pointer Events model when supported. Feature-detect optional APIs, preserve raw committed samples, and handle pointer capture loss and cancellation. Browser gesture handling also depends on `touch-action`; calling `preventDefault` on a pointer event is not a complete gesture policy. The standard does not guarantee hardware palm rejection or uniform sampling quality. [W3C Pointer Events](https://www.w3.org/TR/pointerevents/).

Do not advertise partial/pixel erasing merely because a demo uses `destination-out`: that masks rendered pixels but does not automatically split semantic vector strokes, update lasso hit tests, or make cropped exports consistent. Whole-stroke erasure is simpler and honest for the first version. Partial erasure can later split stroke paths using geometric intersection, with undoable replacement records.

The same issue applies to highlighting: a translucent stroke painted above ink may wash it out. Define a dedicated highlight layer/compositing rule, opacity semantics, and export behavior. Test repeated overlaps, dark mode, and imported images.

## AI-facing objects and engine boundary

The model should not receive or emit engine-internal JSON. Define an application schema with stable object IDs and a small rendering adapter:

```text
LLM output → validated lesson/diagram/quiz data → deterministic layout
           → command batch → canonical document → canvas adapter
```

Use semantic actions such as `insertLesson`, `insertDiagram`, `insertQuiz`, `explainSelection`, `moveObjects`, and `highlightObjects`. A diagram payload names nodes, labels, relations, and an intended layout direction. The application measures labels, places nodes, routes arrows, and writes bound references. Asking the model to invent final pixel coordinates for all objects produces avoidable collision and text-overflow problems.

Persist connector endpoints as references to object IDs plus anchor rules. When a node moves or resizes, reroute connected arrows deterministically. Moving a group, deleting an endpoint, undoing deletion, duplicating a diagram, and importing an archive must preserve or deliberately repair bindings. Use the same command bus for AI and human operations.

Each AI insertion needs one transaction ID, a bounded object count, source/request metadata, and an undo boundary. Use a preview or placeholder region during generation; commit validated complete content. Do not expose arbitrary JavaScript, CSS, SVG, or unrestricted HTML execution as an AI tool. Trusted renderer components should receive typed content.

A small learning-card type interface should define `validate`, `render`, `measure`, `toPlainText`, `toExport`, and `migrate`. This makes new learning activities practical without exposing rendering internals to the model. The engine adapter is deliberately narrow; retaining semantic content and source stroke samples makes future migration feasible, while exact editing behavior will still require migration work.

## Phase 0: four to five working days, with rejection gates

This is a proposed implementation experiment, not work performed during this research. Run Konva hybrid and Excalidraw against the same fixture; include tldraw as a brief experience baseline if desired, not a third full prototype. The comparison should use pinned package versions and record release numbers, license files, browser versions, and physical device models.

1. **Shared fixture and data model:** one handwritten page; a small graph with bound arrows; an equation card; an MCQ with local answer checking; mixed selection; archive save/load. No LLM required—the agent actions are deterministic fixture JSON.
2. **Pen and interaction:** on a real iPad with Pencil/Safari, a real Android pen tablet/Chrome, and desktop mouse/trackpad/keyboard, write for ten minutes, rest the palm, switch tools, erase, lasso, pinch, rotate device, use browser zoom, and resume after backgrounding.
3. **Cards and layering:** tap an answer without moving the card; move the card without answering; write over/beside cards; select ink plus a card; type with the tablet keyboard; pan at several zoom levels. Export must match the chosen visual stacking policy.
4. **Document integrity:** save/reopen offline; duplicate and delete bound diagrams; undo/redo a 20-object AI batch; reload while a save is pending; reopen a fixture from the earlier schema. Compare object content and bindings, not only screenshots.
5. **Performance and export:** replay 1,000 realistic completed strokes plus 50 learning/diagram objects, then stress with 5,000 strokes. Test load, pan, ink, lasso, and one-page export. Large simple-circle demos are not substitute handwriting benchmarks.

Proposed acceptance targets, to be adjusted only with an explicit recorded reason:

| Gate | Pass criterion |
|---|---|
| Basic correctness | No lost or duplicated completed strokes in the test script; no accidental quiz answers from dragging |
| Ink rendering | No repeated visible long stalls; aim for p95 application work per active-ink frame below 8 ms on target tablets at the normal fixture size |
| Navigation | Aim for p95 rendered frame interval below 33 ms during the scripted pan/zoom fixture; report measurement limits |
| Integrity | Exact semantic content/binding round-trip; one-step undo of a fixture AI batch |
| Tablet behavior | All required tasks complete using touch/pen controls; no keyboard-only essential action |
| Export | Ink, arrows, readable equation, and quiz all present; no blank DOM cards or missing assets |
| Extension cost | Add the second card type without patching package internals or introducing another document store |
| License | Reproducible self-hosted production build has no unplanned SDK key dependency |

These timing targets concern app/frame instrumentation, not a claim of measured pen-to-photon latency. Actual device latency requires appropriate external measurement. The high-load fixture is a stress report; it must not silently redefine the normal-use target.

Choose **Excalidraw** if its documented surfaces pass the card, input, persistence, and export gates with manageable application code. Choose **Konva hybrid** if Excalidraw fails those extension gates and Konva passes input/performance/layering gates with an acceptable remaining editor backlog. Choose **tldraw** only if licensing is intentionally accepted and independently tested. If all web candidates fail required tablet writing quality, revisit the platform strategy before building AI features; a native ink surface may be necessary.

## What the next implementation plan must budget

For the Konva path, the first milestone is a durable and usable notebook without AI. AI should not hide an unreliable pen or saving experience. The second milestone is a deterministic fixture-driven canvas tool system with one lesson, one editable diagram, and one quiz. Only then connect the user's chosen direct DeepSeek API behind the application's typed generation interface; the renderer should not depend on which model provider produced the validated content.

The major unresolved evidence is device behavior, not whether libraries can draw rectangles. The four-to-five-day spike can reduce that uncertainty; it cannot certify a production notebook. A subsequent schedule should reserve separate work for editor behavior, offline recovery, cross-device workflow, exports, accessibility, and regression checks, and should keep advanced partial erasing, handwriting recognition, arbitrary rich-media widgets, and collaboration out of the first stable release.
