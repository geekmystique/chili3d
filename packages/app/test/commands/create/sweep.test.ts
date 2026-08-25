// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type IShape,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { SweepedNode } from "../../../src/bodys/sweep";
import { Sweep } from "../../../src/commands/create/sweep";
import {
    ensureGlobalStubApp,
    mockShape,
    seedStepDatas,
    shapeStepResult,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function liveNode(doc: IDocument, name: string, shapeType: ShapeType = ShapeTypes.wire) {
    return new EditableShapeNode({
        document: doc,
        name,
        shape: mockShape({ shapeType }) as unknown as IShape,
        materialId: "mat-1",
    });
}

/**
 * A minimal pick-owner stand-in: sweepRefFromPick reads owner.shape to
 * decide whole-shape vs sub-shape, so a bare `{ id }` mock (the previous
 * pattern here) no longer suffices now that it's driven by comparing the
 * picked shape's type against the owner's own shape's type, not by an
 * `.index` on the picked shape.
 */
function mockOwner(id: string, shapeType: ShapeType, findSubShapes: (type: number) => IShape[] = () => []) {
    return { id, shape: Result.ok({ shapeType, findSubShapes } as unknown as IShape) };
}

describe("Sweep", () => {
    test("should have command metadata", () => {
        const data = (Sweep as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.sweep");
        expect(data.icon).toBe("icon-sweep");
    });

    test("round should default to false", () => {
        const cmd = new Sweep();
        expect(cmd.round).toBe(false);
    });

    test("round setter should update property", () => {
        const cmd = new Sweep();
        cmd.round = true;
        expect(cmd.round).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sweep();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        function buildSweep(round: boolean) {
            const cmd = new Sweep();
            if (round) cmd.round = true;
            wireCommand(cmd);
            seedStepDatas(cmd, [
                // path: a wire, whole-shape pick (owner's own shape is also a wire).
                shapeStepResult([
                    {
                        shape: { shapeType: ShapeTypes.wire },
                        node: mockOwner("path-1", ShapeTypes.wire),
                        point: XYZ.zero,
                    },
                ]),
                // profiles: two wires (multiple selection).
                shapeStepResult([
                    {
                        shape: { shapeType: ShapeTypes.wire },
                        node: mockOwner("prof-1", ShapeTypes.wire),
                        point: XYZ.zero,
                    },
                    {
                        shape: { shapeType: ShapeTypes.wire },
                        node: mockOwner("prof-2", ShapeTypes.wire),
                        point: XYZ.zero,
                    },
                ]),
            ]);
            return cmd;
        }

        test("should build a SweepedNode referencing the path and profile nodes with round=false", () => {
            const cmd = buildSweep(false);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.round).toBe(false);
            expect(node.pathNodeId).toBe("path-1");
            expect(node.profileNodeIds).toEqual(["prof-1", "prof-2"]);
            expect(node.profileShapeTypes).toEqual([ShapeTypes.shape, ShapeTypes.shape]);
            expect(node.profileIndexes).toEqual([-1, -1]);
        });

        test("should propagate round=true to the SweepedNode", () => {
            const cmd = buildSweep(true);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(SweepedNode);
            expect(node.round).toBe(true);
        });

        test("should reference the sub-shape's type and index when a pick is a sub-shape of an existing solid", () => {
            const cmd = new Sweep();
            wireCommand(cmd);
            // shapeStepResult wraps the shape through mockShape(), which copies
            // the given properties onto a fresh object - so isEqual can't rely
            // on reference equality to the original `pickedEdge` object here,
            // it has to compare a marker property that survives the copy.
            const pickedEdge = {
                shapeType: ShapeTypes.edge,
                marker: "picked",
                isEqual: (o: { marker?: string }) => o.marker === "picked",
            };
            const otherEdge = { shapeType: ShapeTypes.edge, marker: "other", isEqual: () => false };
            const solidOwner = mockOwner("solid-1", ShapeTypes.solid, (type) =>
                type === ShapeTypes.edge
                    ? [otherEdge as unknown as IShape, pickedEdge as unknown as IShape]
                    : [],
            );
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: pickedEdge as any, node: solidOwner, point: XYZ.zero }]),
                shapeStepResult([
                    {
                        shape: { shapeType: ShapeTypes.wire },
                        node: mockOwner("prof-1", ShapeTypes.wire),
                        point: XYZ.zero,
                    },
                ]),
            ]);
            const node = (cmd as any).geometryNode();
            expect(node.pathNodeId).toBe("solid-1");
            expect(node.pathShapeType).toBe(ShapeTypes.edge);
            expect(node.pathIndex).toBe(1);
        });
    });

    describe("afterNodeCreated", () => {
        test("should hide, not delete, the whole-shape path and profile source nodes when deleteObjects is true", () => {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            const parent = doc.modelManager.rootNode as unknown as TrackingParent;
            const pathNode = liveNode(doc, "path");
            pathNode.parent = parent;
            const profileNode = liveNode(doc, "profile");
            profileNode.parent = parent;
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: pathNode }]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: profileNode }]),
            ]);

            (cmd as any).afterNodeCreated();

            expect(pathNode.visible).toBe(false);
            expect(profileNode.visible).toBe(false);
            expect(parent.removed).toHaveLength(0);
        });

        test("should leave the source nodes untouched when deleteObjects is false", () => {
            const cmd = new Sweep();
            cmd.deleteObjects = false;
            const { doc } = wireCommand(cmd);
            const pathNode = liveNode(doc, "path");
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: pathNode }]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: liveNode(doc, "profile") }]),
            ]);

            (cmd as any).afterNodeCreated();

            expect(pathNode.visible).toBe(true);
        });

        test("should splice a downstream feature onto the new Sweep when the path already has one", () => {
            const originalFactory = (globalThis as any).app.shapeProvider.factory;
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: new Proxy({}, { get: () => () => Result.ok(mockShape()) }),
            });

            try {
                const cmd = new Sweep();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const pathNode = liveNode(doc, "path");
                pathNode.parent = parent;
                const profileNode = liveNode(doc, "profile");
                profileNode.parent = parent;

                const downstream = new SweepedNode({
                    document: doc,
                    profileNodeIds: [profileNode.id],
                    profileShapeTypes: [ShapeTypes.shape],
                    profileIndexes: [-1],
                    pathNodeId: pathNode.id,
                    pathShapeType: ShapeTypes.shape,
                    pathIndex: -1,
                    round: false,
                });
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [pathNode, profileNode, downstream].find(predicate);
                expect(downstream.shape.isOk).toBe(true); // establishes the pathNode -> downstream DAG edge

                seedStepDatas(cmd, [
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: pathNode }]),
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: profileNode }]),
                ]);

                const newSweep = (cmd as any).geometryNode();
                parent.add(newSweep);
                (cmd as any).afterNodeCreated();

                expect(downstream.pathNodeId).toBe(newSweep.id);
                // newSweep is no longer the end of the chain - downstream is - so it hides itself.
                expect(newSweep.visible).toBe(false);
            } finally {
                Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                    configurable: true,
                    value: originalFactory,
                });
            }
        });
    });

    describe("repositionAfterPath", () => {
        test("should move the new Sweep to sit right after its path node in the tree", () => {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            const pathParent = doc.modelManager.rootNode as unknown as TrackingParent;
            const pathNode = liveNode(doc, "path");
            pathNode.parent = pathParent;
            (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                [pathNode].find(predicate);

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: pathNode }]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: liveNode(doc, "profile") }]),
            ]);

            const newSweep = (cmd as any).geometryNode();
            const sweepParent = doc.modelManager.rootNode as unknown as TrackingParent;
            newSweep.parent = sweepParent;

            const moveSpy = rs.spyOn(sweepParent, "move");
            (cmd as any).afterNodeCreated();

            expect(moveSpy).toHaveBeenCalledWith(newSweep, pathParent, pathNode);
        });

        test("should do nothing when the path node cannot be found", () => {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            (doc.modelManager as any).findNode = () => undefined;

            seedStepDatas(cmd, [
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.wire }, node: mockOwner("missing", ShapeTypes.wire) },
                ]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: liveNode(doc, "profile") }]),
            ]);

            const newSweep = (cmd as any).geometryNode();
            newSweep.parent = doc.modelManager.rootNode;

            expect(() => (cmd as any).afterNodeCreated()).not.toThrow();
        });
    });

    describe("getSteps callbacks", () => {
        test("the second step should carry beforeSelection/afterSelection that update highlight state", () => {
            const cmd = new Sweep();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, point: XYZ.zero }]),
            ]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            // invoking should not throw and should touch the highlighter.
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
