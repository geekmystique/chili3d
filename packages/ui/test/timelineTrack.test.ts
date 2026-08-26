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
    contextMenu: "tt-context-menu",
    contextMenuItem: "tt-context-menu-item",
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
import {
    firePubSub,
    pubSubPubs,
    removeFromReferenceChainCalls,
    setRemoveFromReferenceChainResult,
} from "./_helpers/mockCoreTimeline";

// Mock element helpers
import "./_helpers/mockElement";

// Core value imports must come AFTER the mock helper — importing them earlier would
// load the real "@chili3d/core" before the mock registers.
import { type DependencyGraph, GeometryNode, ReferenceShapeNode } from "@chili3d/core";
import { TimelineTrack } from "../src/timeline/timelineTrack";

type PropertyHandler = (property: string, model: unknown) => void;

// Mirrors GeometryNode.createdOrder: a shared, monotonically increasing counter
// assigned at construction time, independent of where a node ends up in the tree.
let nextCreatedOrder = 0;

class MockNode {
    visible = true;
    parentVisible = true;
    parent: MockNode | undefined;
    nextSibling: MockNode | undefined;
    firstChild: MockNode | undefined;
    readonly createdOrder: number = nextCreatedOrder++;

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

/**
 * A MockNode that also qualifies as `instanceof ReferenceShapeNode`, with a
 * settable `editCommandKey` - stands in for a feature node (EdgeCornerNode,
 * say) in double-click tests. Defined independently of MockNode's own
 * prototype chain (rather than via `extends`) so its prototype can be
 * re-parented onto the mocked ReferenceShapeNode without losing MockNode's
 * onPropertyChanged/removePropertyChanged, which live on MockNode.prototype.
 */
class MockEditableNode {
    visible = true;
    parentVisible = true;
    parent: MockNode | undefined;
    nextSibling: MockNode | undefined;
    editCommandKey: string | undefined;
    readonly createdOrder: number = nextCreatedOrder++;

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
}
Object.setPrototypeOf(MockEditableNode.prototype, ReferenceShapeNode.prototype);

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
    // Spy so preview tests can assert which nodes got shown/hidden without
    // touching model state - the default mock context.setVisible is a no-op.
    (doc.visual.context as unknown as { setVisible: unknown }).setVisible = rs.fn(
        (_node: unknown, _visible: boolean) => {},
    );
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

        test("should render items in creation order", () => {
            fixture = createFixture();
            const items = fixture.track.children;
            expect((items[0] as unknown as { node: unknown }).node).toBe(fixture.model1);
            expect((items[1] as unknown as { node: unknown }).node).toBe(fixture.model2);
        });

        test("should order items by createdOrder even when that differs from tree/nextSibling order", () => {
            // model2 is constructed (and thus created) first, but placed second
            // in the tree's nextSibling chain - the strip must follow creation
            // order, not tree-walk order.
            const model2 = new MockNode("Fillet");
            const model1 = new MockNode("Box");
            model1.nextSibling = model2;
            const root = { firstChild: model1, nextSibling: undefined };
            const doc = makeDoc(root);
            const track = new TimelineTrack(doc);
            document.body.appendChild(track);
            fixture = { doc, model1, model2, track };

            const items = Array.from(track.children) as unknown as { node: unknown }[];
            expect(items.map((i) => i.node)).toEqual([model2, model1]);
        });
    });

    describe("live updates", () => {
        test("should add a new item on a node-added record", () => {
            fixture = createFixture();
            const model3 = new MockNode("Chamfer");
            // A real add() links the node into the tree before firing the record -
            // mirror that here so the post-record tree walk finds it too.
            fixture.model2.firstChild = model3;

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

        test("should keep items in creation order, not tree position, when a node is spliced in mid-chain", () => {
            // A retroactive feature (e.g. a fillet added after-the-fact) gets linked
            // into the tree between model1 and model2 - for correct dependency-chain
            // semantics - even though it was created later than both. The strip must
            // not follow that tree position; model3 stays last, matching when it was
            // actually created.
            fixture = createFixture();
            const model3 = new MockNode("RetroactiveFillet");
            fixture.model1.nextSibling = model3;
            model3.nextSibling = fixture.model2;

            fixture.doc.emitNodeChanged([
                { node: model3, newParent: fixture.model1 } as unknown as NodeRecord,
            ]);

            const items = Array.from(fixture.track.children) as unknown as { node: unknown }[];
            expect(items.map((i) => i.node)).toEqual([fixture.model1, fixture.model2, model3]);
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

    describe("double-click", () => {
        interface EditableFixture {
            doc: ReturnType<typeof makeDoc>;
            model2: MockEditableNode;
            track: TimelineTrack;
        }

        let editFixture: EditableFixture | undefined;

        function createEditableFixture(editCommandKey: string | undefined): EditableFixture {
            const model1 = new MockNode("Box");
            const model2 = new MockEditableNode("Fillet");
            model2.editCommandKey = editCommandKey;
            model1.nextSibling = model2 as unknown as MockNode;
            const root = { firstChild: model1, nextSibling: undefined };

            const doc = makeDoc(root);
            const track = new TimelineTrack(doc);
            document.body.appendChild(track);
            return { doc, model2, track };
        }

        beforeEach(() => {
            fixture = undefined as unknown as Fixture;
            editFixture = undefined;
            pubSubPubs.length = 0;
        });

        afterEach(() => {
            editFixture?.track.remove();
            editFixture?.track.dispose();
            document.body.innerHTML = "";
        });

        test("should select the node and publish executeCommand when it declares an editCommandKey", () => {
            editFixture = createEditableFixture("modify.edgeCornerEdit");
            const item2 = editFixture.track.children[1] as HTMLElement;

            item2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(editFixture.doc.selection.setSelectedNodes).toHaveBeenCalledWith(
                [editFixture.model2],
                false,
            );
            expect(pubSubPubs).toContainEqual({ topic: "executeCommand", args: ["modify.edgeCornerEdit"] });
        });

        test("should do nothing when the node has no editCommandKey", () => {
            editFixture = createEditableFixture(undefined);
            const item2 = editFixture.track.children[1] as HTMLElement;

            item2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(editFixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
            expect(pubSubPubs.some((p: { topic: string }) => p.topic === "executeCommand")).toBe(false);
        });

        test("should ignore a plain (non-reference) node", () => {
            fixture = createFixture();
            const item1 = fixture.track.children[0] as HTMLElement;

            item1.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(fixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
        });

        test("should ignore a double-click that doesn't hit an item", () => {
            editFixture = createEditableFixture("modify.edgeCornerEdit");

            editFixture.track.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(editFixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
        });
    });

    describe("context menu", () => {
        interface EditableFixture {
            doc: ReturnType<typeof makeDoc>;
            model2: MockEditableNode;
            track: TimelineTrack;
        }

        let editFixture: EditableFixture | undefined;

        function createEditableFixture(): EditableFixture {
            const model1 = new MockNode("Box");
            const model2 = new MockEditableNode("Fillet");
            model1.nextSibling = model2 as unknown as MockNode;
            const root = { firstChild: model1, nextSibling: undefined };

            const doc = makeDoc(root);
            (doc.visual as unknown as { update: () => void }).update = rs.fn();
            const track = new TimelineTrack(doc);
            document.body.appendChild(track);
            return { doc, model2, track };
        }

        function rightClick(el: HTMLElement) {
            el.dispatchEvent(
                new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }),
            );
        }

        beforeEach(() => {
            fixture = undefined as unknown as Fixture;
            editFixture = undefined;
            pubSubPubs.length = 0;
            removeFromReferenceChainCalls.length = 0;
            setRemoveFromReferenceChainResult(true);
        });

        afterEach(() => {
            editFixture?.track.remove();
            editFixture?.track.dispose();
            document.body.querySelectorAll(".tt-context-menu").forEach((el) => el.remove());
            document.body.innerHTML = "";
        });

        test("should select the node and open the menu for a reference feature", () => {
            editFixture = createEditableFixture();
            const item2 = editFixture.track.children[1] as HTMLElement;

            rightClick(item2);

            expect(editFixture.doc.selection.setSelectedNodes).toHaveBeenCalledWith(
                [editFixture.model2],
                false,
            );
            expect(document.body.querySelector(".tt-context-menu")).not.toBeNull();
        });

        test("should prevent the browser's own context menu", () => {
            editFixture = createEditableFixture();
            const item2 = editFixture.track.children[1] as HTMLElement;
            const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

            item2.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
        });

        test("should ignore a plain (non-reference) node", () => {
            fixture = createFixture();
            const item1 = fixture.track.children[0] as HTMLElement;

            rightClick(item1);

            expect(fixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
            expect(document.body.querySelector(".tt-context-menu")).toBeNull();
        });

        test("should ignore a right-click that doesn't hit an item", () => {
            editFixture = createEditableFixture();

            rightClick(editFixture.track);

            expect(document.body.querySelector(".tt-context-menu")).toBeNull();
        });

        test("clicking Delete should call removeFromReferenceChain, close the menu, and update the visual", () => {
            editFixture = createEditableFixture();
            const item2 = editFixture.track.children[1] as HTMLElement;
            rightClick(item2);

            const deleteItem = document.body.querySelector(".tt-context-menu-item") as unknown as {
                _onclick: () => void;
            };
            deleteItem._onclick();

            expect(removeFromReferenceChainCalls).toHaveLength(1);
            expect(removeFromReferenceChainCalls[0][1]).toBe(editFixture.model2);
            expect(document.body.querySelector(".tt-context-menu")).toBeNull();
            expect(editFixture.doc.visual.update).toHaveBeenCalledTimes(1);
        });

        test("should show a blocked toast and not update the visual when removeFromReferenceChain refuses", () => {
            setRemoveFromReferenceChainResult(false);
            editFixture = createEditableFixture();
            const item2 = editFixture.track.children[1] as HTMLElement;
            rightClick(item2);

            const deleteItem = document.body.querySelector(".tt-context-menu-item") as unknown as {
                _onclick: () => void;
            };
            deleteItem._onclick();

            expect(pubSubPubs).toContainEqual({ topic: "showToast", args: ["toast.deleteFeature.blocked"] });
            expect(editFixture.doc.visual.update).not.toHaveBeenCalled();
        });
    });

    describe("timeline preview (rollback)", () => {
        let chainFixture: ChainFixture;

        beforeEach(() => {
            fixture = undefined as unknown as Fixture;
            chainFixture = undefined as unknown as ChainFixture;
        });

        afterEach(() => {
            chainFixture?.track.remove();
            chainFixture?.track.dispose();
            document.body.innerHTML = "";
        });

        function setVisibleSpy(f: ChainFixture) {
            return f.doc.visual.context.setVisible as unknown as ReturnType<typeof rs.fn>;
        }

        test("clicking a middle item shows it and hides everything after it, leaving what's before untouched", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();

            expect(spy).toHaveBeenCalledWith(chainFixture.model2, true);
            expect(spy).toHaveBeenCalledWith(chainFixture.model3, false);
            expect(spy).not.toHaveBeenCalledWith(chainFixture.model1, expect.anything());
        });

        test("clicking a later item replaces the previous preview instead of stacking", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const item3 = chainFixture.track.children[2] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click(); // hides model3
            spy.mockClear();
            item3.click(); // nothing after model3 - model3's own hide from before must be undone

            expect(spy).toHaveBeenCalledWith(chainFixture.model3, true);
        });

        test("ctrl-click (multi-select) does not activate a preview", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

            expect(spy).not.toHaveBeenCalled();
        });

        test("closeCommandContext restores the preview to the real, current visibility", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();
            spy.mockClear();
            firePubSub("closeCommandContext");

            // model3.visible/parentVisible are both still true - restore renders that.
            expect(spy).toHaveBeenCalledWith(chainFixture.model2, true);
            expect(spy).toHaveBeenCalledWith(chainFixture.model3, true);
        });

        test("a structural tree change restores the preview before applying itself", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();
            spy.mockClear();
            chainFixture.doc.emitNodeChanged([
                { node: chainFixture.model3, newParent: undefined } as unknown as NodeRecord,
            ]);

            expect(spy).toHaveBeenCalledWith(chainFixture.model3, true);
        });

        test("editing the previewed node's own property (e.g. via the Properties panel) restores the preview", () => {
            // A direct property edit (length, radius, ...) never runs a command,
            // so closeCommandContext never fires for it - only the node's own
            // onPropertyChanged reliably signals this kind of edit.
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();
            spy.mockClear();
            chainFixture.model2.emit("length");

            expect(spy).toHaveBeenCalledWith(chainFixture.model2, true);
            expect(spy).toHaveBeenCalledWith(chainFixture.model3, true);
        });

        test("editing an unrelated (non-previewed) node's property does not restore the preview", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();
            spy.mockClear();
            chainFixture.model1.emit("name");

            expect(spy).not.toHaveBeenCalled();
        });

        test("dispose restores an active preview", () => {
            chainFixture = createChainFixture();
            const item2 = chainFixture.track.children[1] as HTMLElement;
            const spy = setVisibleSpy(chainFixture);

            item2.click();
            spy.mockClear();
            chainFixture.track.remove();
            chainFixture.track.dispose();

            expect(spy).toHaveBeenCalledWith(chainFixture.model3, true);

            // dispose() already ran above (and nils out `document`) - prevent the
            // outer afterEach from disposing this fixture a second time.
            chainFixture = undefined as unknown as ChainFixture;
        });

        test("double-clicking a feature previews it too", () => {
            const model1 = new MockNode("Box");
            const model2 = new MockEditableNode("Fillet");
            model2.editCommandKey = "modify.edgeCornerEdit";
            const model3 = new MockNode("Rectangle");
            model1.nextSibling = model2 as unknown as MockNode;
            (model2 as unknown as MockNode).nextSibling = model3;
            const root = { firstChild: model1, nextSibling: undefined };
            const doc = makeDoc(root);
            const track = new TimelineTrack(doc);
            document.body.appendChild(track);
            const spy = doc.visual.context.setVisible as unknown as ReturnType<typeof rs.fn>;

            const item2 = track.children[1] as HTMLElement;
            item2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(spy).toHaveBeenCalledWith(model3, false);

            track.remove();
            track.dispose();
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

        test("should close an open context menu", () => {
            const model1 = new MockNode("Box");
            const model2 = new MockEditableNode("Fillet");
            model1.nextSibling = model2 as unknown as MockNode;
            const root = { firstChild: model1, nextSibling: undefined };
            const doc = makeDoc(root);
            const track = new TimelineTrack(doc);
            document.body.appendChild(track);

            const item2 = track.children[1] as HTMLElement;
            item2.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
            expect(document.body.querySelector(".tt-context-menu")).not.toBeNull();

            track.remove();
            track.dispose();

            expect(document.body.querySelector(".tt-context-menu")).toBeNull();
        });
    });
});
