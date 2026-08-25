// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IShape,
    type IShapeFactory,
    type IStep,
    type IView,
    Matrix4,
    Plane,
    PubSub,
    Result,
    SelectShapeStep,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { BooleanNode } from "../../src/bodys/boolean";
import { EdgeCornerNode } from "../../src/bodys/edgeCorner";
import { BooleanCommon, BooleanCut, BooleanFuse } from "../../src/commands/boolean";
import {
    ensureGlobalStubApp,
    makeParent,
    mockShape,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "./commandTestUtils";

/** The shape-factory spies installed by installShapeFactory. */
interface BooleanFactorySpies {
    booleanCommon: ReturnType<typeof rs.fn>;
    booleanCut: ReturnType<typeof rs.fn>;
    booleanFuse: ReturnType<typeof rs.fn>;
}

/**
 * Install a custom shape factory for boolean tests. Returns the factory spies
 * (for call assertions) plus a restore function.
 */
function installShapeFactory(result: Result<IShape>): { factory: BooleanFactorySpies; restore: () => void } {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    const factory: BooleanFactorySpies = {
        booleanCommon: rs.fn((_shapes: IShape[], _tools: IShape[]) => result),
        booleanCut: rs.fn((_shapes: IShape[], _tools: IShape[]) => result),
        booleanFuse: rs.fn((_shapes: IShape[], _tools: IShape[], _keepEdges: boolean) => result),
    };

    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => ({
            shapeProvider: { factory: factory as unknown as IShapeFactory, converter: {} as any },
        }),
    });
    return {
        factory,
        restore: () => {
            if (previous) {
                Object.defineProperty(globalThis, "app", previous);
            }
        },
    };
}

/** A fake shape with setTolerance (required by booleanOperate). */
function shapeWithTolerance(extra: Record<string, unknown> = {}): IShape {
    return mockShape({
        shapeType: ShapeTypes.solid,
        setTolerance: () => {},
        ...extra,
    }) as unknown as IShape;
}

/** Build a minimal VisualShapeData entry for step seeding. */
function visShape(s: IShape, parent = makeParent()): VisualShapeData {
    return {
        shape: s,
        transform: Matrix4.identity(),
        point: undefined,
        indexes: [],
        owner: {
            node: { parent, previousSibling: undefined, nextSibling: undefined },
            getNode(this: { node: unknown }) {
                return this.node;
            },
        },
    } as unknown as VisualShapeData;
}

/**
 * Build a base + tool EditableShapeNode pair and wire `doc.modelManager.findNode`
 * to resolve them, so BooleanNode.generateShape() (which looks nodes up by id)
 * can find them the same way it would against a real document.
 */
function installInputNodes(doc: ReturnType<typeof wireCommand>["doc"]) {
    const baseNode = new EditableShapeNode({ document: doc, name: "base", shape: shapeWithTolerance() });
    const toolNode = new EditableShapeNode({ document: doc, name: "tool", shape: shapeWithTolerance() });
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
        [baseNode, toolNode].find(predicate);
    return { baseNode, toolNode };
}

const VIEW_STUB = {
    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
    type: "shape",
} as const;

describe("BooleanOperate (via BooleanCommon)", () => {
    test("should have command metadata", () => {
        const data = (BooleanCommon as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("boolean.common");
        expect(data.icon).toBe("icon-booleanCommon");
    });

    test("getBooleanOperateType should return 'common'", () => {
        const cmd = new BooleanCommon();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("common");
    });

    test("getSteps should return two SelectShapeSteps", () => {
        const cmd = new BooleanCommon();
        const steps = (cmd as any).getSteps() as IStep[];
        expect(steps.length).toBe(2);
        expect(steps[0]).toBeInstanceOf(SelectShapeStep);
        expect(steps[1]).toBeInstanceOf(SelectShapeStep);
    });

    test("keepTools should default to false", () => {
        const cmd = new BooleanCommon();
        expect(cmd.keepTools).toBe(false);
    });

    test("keepTools setter should update property", () => {
        const cmd = new BooleanCommon();
        cmd.keepTools = true;
        expect(cmd.keepTools).toBe(true);

        cmd.keepTools = false;
        expect(cmd.keepTools).toBe(false);
    });

    describe("getBooleanShape", () => {
        test("should call booleanCommon for type 'common'", () => {
            const { restore, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const shape = shapeWithTolerance();
                const result = (cmd as any).getBooleanShape("common", shape, []);
                expect(result.isOk).toBe(true);
                expect(factory.booleanCommon).toHaveBeenCalledWith([shape], []);
                expect(factory.booleanCut).not.toHaveBeenCalled();
                expect(factory.booleanFuse).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        });

        test("should call booleanCut for type 'cut'", () => {
            const { restore, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const shape = shapeWithTolerance();
                const result = (cmd as any).getBooleanShape("cut", shape, []);
                expect(result.isOk).toBe(true);
                expect(factory.booleanCut).toHaveBeenCalledWith([shape], []);
                expect(factory.booleanCommon).not.toHaveBeenCalled();
                expect(factory.booleanFuse).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        });

        test("should call booleanFuse for type 'fuse'", () => {
            const { restore, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const shape = shapeWithTolerance();
                const result = (cmd as any).getBooleanShape("fuse", shape, []);
                expect(result.isOk).toBe(true);
                expect(factory.booleanFuse).toHaveBeenCalledWith([shape], [], true);
                expect(factory.booleanCommon).not.toHaveBeenCalled();
                expect(factory.booleanCut).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        });
    });

    describe("booleanOperate", () => {
        test("should transform shapes and call the shape factory", () => {
            const { restore } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);

                const s1 = shapeWithTolerance();
                const s2 = shapeWithTolerance();

                seedStepDatas(cmd, [{ ...VIEW_STUB, shapes: [visShape(s1)], nodes: [] }]);

                const result = (cmd as any).booleanOperate([
                    {
                        shape: s2,
                        transform: Matrix4.identity(),
                        point: undefined,
                        indexes: [],
                        owner: { node: {}, getNode: () => ({}) },
                    },
                ]);
                expect(result.isOk).toBe(true);
            } finally {
                restore();
            }
        });
    });

    describe("executeMainTask", () => {
        test("should create a reference-based BooleanNode and add it to the document", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const { restore: restoreFactory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);
                const { baseNode, toolNode } = installInputNodes(doc);

                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [baseNode] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [toolNode] },
                ]);

                (cmd as any).executeMainTask();

                // executeMainTask adds the new node via document.modelManager.rootNode.add(...)
                const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
                expect(rootNode.added).toHaveLength(1);
                const node = rootNode.added[0] as BooleanNode;
                expect(node).toBeInstanceOf(BooleanNode);
                expect(node.baseNodeId).toBe(baseNode.id);
                expect(node.toolNodeIds).toEqual([toolNode.id]);
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should publish toast when boolean operation fails", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const { restore: restoreFactory } = installShapeFactory(Result.err("boolean failed"));
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);
                const { baseNode, toolNode } = installInputNodes(doc);

                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [baseNode] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [toolNode] },
                ]);

                (cmd as any).executeMainTask();
                expect(pubSpy).toHaveBeenCalledWith("showToast", "error.default:{0}", "boolean failed");

                // A failed node is never added, and the source nodes stay visible.
                const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
                expect(rootNode.added).toHaveLength(0);
                expect(baseNode.visible).toBe(true);
            } finally {
                pubSpy.mockRestore();
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should hide (not delete) the consumed nodes on success", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const { restore: restoreFactory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);
                const { baseNode, toolNode } = installInputNodes(doc);

                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [baseNode] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [toolNode] },
                ]);

                (cmd as any).executeMainTask();

                // hidden, not removed from the tree - the boolean node still references them
                expect(baseNode.visible).toBe(false);
                expect(toolNode.visible).toBe(false);
                expect(baseNode.parent).toBeUndefined();
                expect(toolNode.parent).toBeUndefined();
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should splice a downstream feature onto the new BooleanNode when the base already has one", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const { factory, restore: restoreFactory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            (factory as unknown as { fillet: () => Result<IShape> }).fillet = () =>
                Result.ok(shapeWithTolerance());
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);
                const { baseNode, toolNode } = installInputNodes(doc);

                // downstream already references baseNode directly (e.g. a fillet
                // applied earlier to the same body).
                const downstream = new EdgeCornerNode({
                    document: doc,
                    operateType: "fillet",
                    baseNodeId: baseNode.id,
                    edgeIndexes: [0],
                    value: 1,
                });
                const findInputNodes = (doc.modelManager as any).findNode;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    findInputNodes(predicate) ?? [downstream].find(predicate);
                expect(downstream.shape.isOk).toBe(true); // establishes the baseNode -> downstream DAG edge

                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [baseNode] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [toolNode] },
                ]);

                (cmd as any).executeMainTask();

                const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
                const newBoolean = rootNode.added[0] as BooleanNode;
                expect(downstream.baseNodeId).toBe(newBoolean.id);
                // newBoolean is no longer the end of the chain - downstream is - so it hides itself.
                expect(newBoolean.visible).toBe(false);
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });

        test("should keep tools visible when keepTools is true", () => {
            const restoreApp = ensureGlobalStubApp();
            const restoreTx = stubTransactionRun();
            const { restore: restoreFactory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                cmd.keepTools = true;
                const { doc } = wireCommand(cmd);
                const { baseNode, toolNode } = installInputNodes(doc);

                seedStepDatas(cmd, [
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [baseNode] },
                    { ...VIEW_STUB, shapes: [visShape(shapeWithTolerance())], nodes: [toolNode] },
                ]);

                (cmd as any).executeMainTask();

                const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
                expect(rootNode.added).toHaveLength(1);
                expect(rootNode.added[0]).toBeInstanceOf(BooleanNode);
                // keepTools hides only the base node; tool nodes stay visible
                expect(baseNode.visible).toBe(false);
                expect(toolNode.visible).toBe(true);
            } finally {
                restoreFactory();
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("onToolsChanged (debounced preview)", () => {
        test("should do nothing when no shapes in stepData", () => {
            rs.useFakeTimers();
            const restoreApp = ensureGlobalStubApp();
            const { restore: restoreFactory, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);
                (cmd as any).stepDatas = [];

                (cmd as any).onToolsChanged([]);
                rs.advanceTimersByTime(25);

                // No first shape -> early return, the boolean factory is never touched
                expect(factory.booleanCommon).not.toHaveBeenCalled();
                expect(factory.booleanCut).not.toHaveBeenCalled();
                expect(factory.booleanFuse).not.toHaveBeenCalled();
            } finally {
                rs.useRealTimers();
                restoreFactory();
                restoreApp();
            }
        });

        test("should do nothing when first step data has no shapes", () => {
            rs.useFakeTimers();
            const restoreApp = ensureGlobalStubApp();
            const { restore: restoreFactory, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                wireCommand(cmd);
                seedStepDatas(cmd, [{ ...VIEW_STUB, shapes: [], nodes: [] }]);

                (cmd as any).onToolsChanged([]);
                rs.advanceTimersByTime(25);

                expect(factory.booleanCommon).not.toHaveBeenCalled();
            } finally {
                rs.useRealTimers();
                restoreFactory();
                restoreApp();
            }
        });

        test("should restore visibility without a preview when the selection is cleared", () => {
            rs.useFakeTimers();
            const restoreApp = ensureGlobalStubApp();
            const { restore: restoreFactory, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);

                const parent = makeParent({ id: "parent0" });
                const firstShape = visShape(shapeWithTolerance(), parent);
                (firstShape.owner as any).visible = false;
                seedStepDatas(cmd, [
                    {
                        ...VIEW_STUB,
                        shapes: [firstShape],
                        nodes: [],
                    },
                ]);

                // Clearing the tool selection only restores the first shape's visibility
                (cmd as unknown as { onToolsChanged: (selected: unknown[]) => void }).onToolsChanged([]);
                rs.advanceTimersByTime(25);

                expect(factory.booleanCommon).not.toHaveBeenCalled();
                expect((firstShape.owner as any).visible).toBe(true);
                expect(doc.visual.context.displayMesh).not.toHaveBeenCalled();
            } finally {
                rs.useRealTimers();
                restoreFactory();
                restoreApp();
            }
        });

        test("should collect tool shapes and show a debounced preview", () => {
            rs.useFakeTimers();
            const restoreApp = ensureGlobalStubApp();
            const { restore: restoreFactory, factory } = installShapeFactory(Result.ok(shapeWithTolerance()));
            try {
                const cmd = new BooleanCommon();
                const { doc } = wireCommand(cmd);

                const parent = makeParent({ id: "parent0" });
                const firstShape = visShape(shapeWithTolerance(), parent);
                seedStepDatas(cmd, [{ ...VIEW_STUB, shapes: [firstShape], nodes: [] }]);

                const tool = visShape(shapeWithTolerance());
                (cmd as any).onToolsChanged([tool]);

                // Debounced: the factory is not called before the delay elapses
                expect(factory.booleanCommon).not.toHaveBeenCalled();
                rs.advanceTimersByTime(25);

                expect(factory.booleanCommon).toHaveBeenCalledTimes(1);
                // tool shapes are collected and passed as the second argument
                expect(factory.booleanCommon.mock.calls[0][1]).toHaveLength(1);
                // the first shape's visual is hidden and a temp preview mesh is shown
                expect((firstShape.owner as any).visible).toBe(false);
                expect(doc.visual.context.displayMesh).toHaveBeenCalled();
            } finally {
                rs.useRealTimers();
                restoreFactory();
                restoreApp();
            }
        });
    });
});

describe("BooleanCut", () => {
    test("should have command metadata", () => {
        const data = (BooleanCut as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("boolean.cut");
        expect(data.icon).toBe("icon-booleanCut");
    });

    test("getBooleanOperateType should return 'cut'", () => {
        const cmd = new BooleanCut();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("cut");
    });

    test("should extend BooleanOperate (inherit keepTools)", () => {
        const cmd = new BooleanCut();
        expect(cmd.keepTools).toBe(false);
    });
});

describe("BooleanFuse", () => {
    test("should have command metadata", () => {
        const data = (BooleanFuse as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("boolean.join");
        expect(data.icon).toBe("icon-booleanFuse");
    });

    test("getBooleanOperateType should return 'fuse'", () => {
        const cmd = new BooleanFuse();
        const type = (cmd as any).getBooleanOperateType();
        expect(type).toBe("fuse");
    });

    test("should extend BooleanOperate (inherit keepTools)", () => {
        const cmd = new BooleanFuse();
        expect(cmd.keepTools).toBe(false);
    });
});
