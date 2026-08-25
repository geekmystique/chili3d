// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode, NodeRecord } from "@chili3d/core";
// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument, type MockDocumentOverrides } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";

// CSS modules under test
rs.mock("../src/timeline/timelineTrack.module.css", () => ({
    track: "tt-track",
    selected: "tt-selected",
    related: "tt-related",
}));

rs.mock("../src/timeline/timelineItem.module.css", () => ({
    chip: "ti-chip",
}));

rs.mock("../src/project/tree/treeItem.module.css", () => ({
    name: "tri-name",
    icon: "tri-icon",
    "parent-hidden": "tri-parent-hidden",
}));

// Mock core: GeometryNode marker for instanceof checks, immediate Transaction, no-op Binding
import "./_helpers/mockCoreTimeline";

// Mock element helpers
import "./_helpers/mockElement";

// Core value imports must come AFTER the mock helper — importing them earlier would
// load the real "@chili3d/core" before the mock registers.
import { type DependencyGraph, GeometryNode } from "@chili3d/core";
import { TimelineTrack } from "../src/timeline/timelineTrack";

type PropertyHandler = (property: string, model: unknown) => void;

class MockNode {
    visible = true;
    parentVisible = true;
    parent: MockNode | undefined;
    nextSibling: MockNode | undefined;

    constructor(
        readonly name: string,
        readonly id: string = name,
    ) {}

    private handlers = new Set<PropertyHandler>();
    onPropertyChanged(handler: PropertyHandler) {
        this.handlers.add(handler);
    }
    removePropertyChanged(handler: PropertyHandler) {
        this.handlers.delete(handler);
    }
    emit(property: string) {
        this.handlers.forEach((h) => {
            h(property, this);
        });
    }
}

// TimelineTrack collects nodes via `instanceof GeometryNode` - link the mock node's
// prototype chain to the mocked GeometryNode so every MockNode instance qualifies.
// A plain object (not linked) stands in for the document's root folder, which is
// never itself a GeometryNode.
Object.setPrototypeOf(MockNode.prototype, GeometryNode.prototype);

type NodeObserver = (records: NodeRecord[]) => void;

type DocHarness = IDocument & {
    emitNodeChanged: (records: NodeRecord[]) => void;
    emitSelection: (nodes: INode[]) => void;
};

function makeDoc(rootNode: unknown): DocHarness {
    const nodeObservers = new Set<NodeObserver>();
    const selectionHandlers = new Set<(nodes: INode[]) => void>();
    const doc = createMockDocument({
        modelManager: {
            rootNode,
            addNodeObserver: (h: NodeObserver) => nodeObservers.add(h),
            removeNodeObserver: (h: NodeObserver) => nodeObservers.delete(h),
        } as unknown as MockDocumentOverrides["modelManager"],
        selection: {
            onNodeChanged: {
                sub: (h: (nodes: INode[]) => void) => selectionHandlers.add(h),
                remove: (h: (nodes: INode[]) => void) => selectionHandlers.delete(h),
            },
            setSelectedNodes: rs.fn((_nodes: INode[], _ctrl: boolean) => 0),
        } as unknown as MockDocumentOverrides["selection"],
    });
    return Object.assign(doc, {
        emitNodeChanged: (records: NodeRecord[]) => {
            nodeObservers.forEach((h) => {
                h(records);
            });
        },
        emitSelection: (nodes: INode[]) => {
            selectionHandlers.forEach((h) => {
                h(nodes);
            });
        },
    });
}

interface Fixture {
    doc: ReturnType<typeof makeDoc>;
    model1: MockNode;
    model2: MockNode;
    track: TimelineTrack;
}

function createFixture(): Fixture {
    const model1 = new MockNode("Box");
    const model2 = new MockNode("Fillet");
    model1.nextSibling = model2;
    const root = { firstChild: model1, nextSibling: undefined };

    const doc = makeDoc(root);
    const track = new TimelineTrack(doc);
    document.body.appendChild(track);
    return { doc, model1, model2, track };
}

interface ChainFixture extends Fixture {
    model3: MockNode;
}

/** Box <- Fillet <- Chamfer, wired into the document's real DependencyGraph by id. */
function createChainFixture(): ChainFixture {
    const model1 = new MockNode("Box");
    const model2 = new MockNode("Fillet");
    const model3 = new MockNode("Chamfer");
    model1.nextSibling = model2;
    model2.nextSibling = model3;
    const root = { firstChild: model1, nextSibling: undefined };

    const doc = makeDoc(root);
    const graph: DependencyGraph = doc.modelManager.dependencyGraph;
    graph.setDependencies({ id: model2.id, recompute: () => {} }, [model1.id]);
    graph.setDependencies({ id: model3.id, recompute: () => {} }, [model2.id]);

    const track = new TimelineTrack(doc);
    document.body.appendChild(track);
    return { doc, model1, model2, model3, track };
}

describe("TimelineTrack", () => {
    let fixture: Fixture;

    afterEach(() => {
        fixture?.track.remove();
        fixture?.track.dispose();
        document.body.innerHTML = "";
    });

    describe("initial population", () => {
        test("should build a timeline-item for every GeometryNode in the tree", () => {
            fixture = createFixture();
            expect(fixture.track.className).toBe("tt-track");
            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(2);
        });

        test("should render items in tree order", () => {
            fixture = createFixture();
            const items = fixture.track.children;
            expect((items[0] as unknown as { node: unknown }).node).toBe(fixture.model1);
            expect((items[1] as unknown as { node: unknown }).node).toBe(fixture.model2);
        });
    });

    describe("live updates", () => {
        test("should add a new item on a node-added record", () => {
            fixture = createFixture();
            const model3 = new MockNode("Chamfer");

            fixture.doc.emitNodeChanged([
                { node: model3, newParent: fixture.model2 } as unknown as NodeRecord,
            ]);

            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(3);
        });

        test("should ignore a record for a node that isn't a GeometryNode", () => {
            fixture = createFixture();
            const folder = { name: "Group" };

            fixture.doc.emitNodeChanged([
                { node: folder, newParent: fixture.model2 } as unknown as NodeRecord,
            ]);

            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(2);
        });

        test("should remove the item on a node-removed record", () => {
            fixture = createFixture();

            fixture.doc.emitNodeChanged([
                { node: fixture.model2, newParent: undefined } as unknown as NodeRecord,
            ]);

            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(1);
        });

        test("should not add the same node twice", () => {
            fixture = createFixture();

            fixture.doc.emitNodeChanged([
                { node: fixture.model1, newParent: fixture.model2 } as unknown as NodeRecord,
            ]);

            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(2);
        });
    });

    describe("selection", () => {
        test("should add selected style to newly selected nodes and remove from previous", () => {
            fixture = createFixture();
            const item1 = fixture.track.children[0] as HTMLElement;
            const item2 = fixture.track.children[1] as HTMLElement;

            fixture.doc.emitSelection([fixture.model1 as unknown as INode]);
            expect(item1.classList.contains("tt-selected")).toBe(true);

            fixture.doc.emitSelection([fixture.model2 as unknown as INode]);
            expect(item1.classList.contains("tt-selected")).toBe(false);
            expect(item2.classList.contains("tt-selected")).toBe(true);
        });

        test("should select the node via click", () => {
            fixture = createFixture();
            const item1 = fixture.track.children[0] as HTMLElement;

            item1.click();

            expect(fixture.doc.selection.setSelectedNodes).toHaveBeenCalledWith([fixture.model1], false);
        });

        test("should pass ctrlKey through to setSelectedNodes for toggle-select", () => {
            fixture = createFixture();
            const item1 = fixture.track.children[0] as HTMLElement;

            item1.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

            expect(fixture.doc.selection.setSelectedNodes).toHaveBeenCalledWith([fixture.model1], true);
        });

        test("should ignore a click that doesn't hit an item", () => {
            fixture = createFixture();

            fixture.track.click();

            expect(fixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
        });
    });

    describe("dependency highlighting", () => {
        let chainFixture: ChainFixture;

        beforeEach(() => {
            // The outer afterEach disposes `fixture`; keep it cleared here so it doesn't
            // re-dispose a fixture left over from a prior top-level test.
            fixture = undefined as unknown as Fixture;
        });

        afterEach(() => {
            chainFixture?.track.remove();
            chainFixture?.track.dispose();
            document.body.innerHTML = "";
        });

        test("should mark ancestors and descendants of the selected node as related, not selected", () => {
            chainFixture = createChainFixture();
            const [item1, item2, item3] = Array.from(chainFixture.track.children) as HTMLElement[];

            chainFixture.doc.emitSelection([chainFixture.model2 as unknown as INode]);

            expect(item1.classList.contains("tt-related")).toBe(true);
            expect(item1.classList.contains("tt-selected")).toBe(false);
            expect(item2.classList.contains("tt-selected")).toBe(true);
            expect(item2.classList.contains("tt-related")).toBe(false);
            expect(item3.classList.contains("tt-related")).toBe(true);
            expect(item3.classList.contains("tt-selected")).toBe(false);
        });

        test("should mark only downstream dependents as related when selecting the root", () => {
            chainFixture = createChainFixture();
            const [item1, item2, item3] = Array.from(chainFixture.track.children) as HTMLElement[];

            chainFixture.doc.emitSelection([chainFixture.model1 as unknown as INode]);

            expect(item1.classList.contains("tt-selected")).toBe(true);
            expect(item2.classList.contains("tt-related")).toBe(true);
            expect(item3.classList.contains("tt-related")).toBe(true);
        });

        test("should clear related styling once selection moves away", () => {
            chainFixture = createChainFixture();
            const [item1, , item3] = Array.from(chainFixture.track.children) as HTMLElement[];

            chainFixture.doc.emitSelection([chainFixture.model2 as unknown as INode]);
            chainFixture.doc.emitSelection([]);

            expect(item1.classList.contains("tt-related")).toBe(false);
            expect(item3.classList.contains("tt-related")).toBe(false);
        });
    });

    describe("dispose", () => {
        test("should remove all items and stop observing further changes", () => {
            fixture = createFixture();
            fixture.track.remove();
            fixture.track.dispose();

            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(0);

            const model3 = new MockNode("AfterDispose");
            fixture.doc.emitNodeChanged([
                { node: model3, newParent: fixture.model2 } as unknown as NodeRecord,
            ]);
            expect(fixture.track.querySelectorAll("timeline-item").length).toBe(0);

            fixture = undefined as unknown as Fixture;
        });
    });
});
