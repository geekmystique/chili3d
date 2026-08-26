// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type INode,
    type IShape,
    Result,
    ShapeTypes,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { SweepedNode, sweepRefFromPick } from "../../src/bodys/sweep";
import { createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by SweepedNode.generateShape()
 * on each resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType overrides the
 * test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("SweepedNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let pathNode: EditableShapeNode;
    let profileNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        pathNode = new EditableShapeNode({
            document: doc,
            name: "path",
            shape: selfTransforming(createMockWire()),
        });
        profileNode = new EditableShapeNode({
            document: doc,
            name: "profile",
            shape: selfTransforming(createMockWire()),
        });
        nodes.push(pathNode, profileNode);
    });

    function makeNode(round = false) {
        return new SweepedNode({
            document: doc,
            profileNodeIds: [profileNode.id],
            profileShapeTypes: [ShapeTypes.shape],
            profileIndexes: [-1],
            pathNodeId: pathNode.id,
            pathShapeType: ShapeTypes.shape,
            pathIndex: -1,
            round,
        });
    }

    describe("constructor", () => {
        test("should initialize profile and path references, and round", () => {
            const node = makeNode(true);
            expect(node.profileNodeIds).toEqual([profileNode.id]);
            expect(node.pathNodeId).toBe(pathNode.id);
            expect(node.round).toBe(true);
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.sweep");
        });

        test("should default round to false", () => {
            expect(makeNode(false).round).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.sweep", () => {
            expect(makeNode().display()).toBe("body.sweep");
        });
    });

    describe("redirectReference", () => {
        test("should redirect pathNodeId and recompute when it matches", () => {
            const newPath = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newPath);
            const sweep = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ sweep });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(pathNode.id, newPath.id);

            expect(changed).toBe(true);
            expect(node.pathNodeId).toBe(newPath.id);
            expect(sweep).toHaveBeenCalledTimes(2);
        });

        test("should redirect a matching profileNodeIds entry and recompute", () => {
            const newProfile = new EditableShapeNode({
                document: doc,
                name: "newProfile",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newProfile);
            const sweep = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ sweep });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(profileNode.id, newProfile.id);

            expect(changed).toBe(true);
            expect(node.profileNodeIds).toEqual([newProfile.id]);
        });

        test("should return false and leave references untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.pathNodeId).toBe(pathNode.id);
            expect(node.profileNodeIds).toEqual([profileNode.id]);
        });
    });

    describe("primaryInputId", () => {
        test("should be the pathNodeId", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();

            expect(node.primaryInputId).toBe(pathNode.id);
        });
    });

    describe("setters", () => {
        test("setting round should update value and regenerate the shape", () => {
            const sweep = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ sweep });
            const node = makeNode(false);
            expect(node.shape.isOk).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(1);

            node.round = true;

            expect(node.round).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on round change", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.round = true;
            expect(handler.mock.calls.map((c) => c[0])).toContain("round");
        });
    });

    describe("generateShape", () => {
        test("should return an error when the path node no longer exists", () => {
            nodes = [profileNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(pathNode.id);
        });

        test("should return an error when a profile node no longer exists", () => {
            nodes = [pathNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(profileNode.id);
        });

        test("should call shapeFactory.sweep with the resolved path and profile shapes", () => {
            const sweep = rs.fn((_profiles: IShape[], _path: IShape, _round: boolean) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ sweep });
            const result = makeNode(true).generateShape();
            expect(result.isOk).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(1);
            expect(sweep.mock.calls[0][0]).toEqual([profileNode.shape.value]);
            expect(sweep.mock.calls[0][1]).toBe(pathNode.shape.value);
            expect(sweep.mock.calls[0][2]).toBe(true);
        });

        test("should recompute when the path node's shape changes", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                sweep: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            pathNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(1);
        });

        test("should recompute when a profile node's shape changes", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                sweep: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            profileNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ sweep: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                sweep: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            pathNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(0);
        });

        test("should convert an edge path to a wire via shapeFactory.wire", () => {
            pathNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })));
            const wireShape = createMockWire();
            const wire = rs.fn((_edges: any[]) => Result.ok(wireShape as any));
            const sweep = rs.fn((_profiles: IShape[], _path: IShape, _round: boolean) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ wire, sweep });
            const result = makeNode().generateShape();
            expect(wire).toHaveBeenCalledTimes(1);
            expect(sweep.mock.calls[0][1]).toBe(wireShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.sweep fails", () => {
            setupShapeFactoryMock({
                sweep: () => Result.err("sweep creation failed"),
            });
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape references (e.g. an edge of an existing solid)", () => {
        test("should resolve the sub-shape at pathIndex via findSubShapes and use it as the path", () => {
            const targetEdge: any = { shapeType: ShapeTypes.edge };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.edge ? [targetEdge] : []);
            pathNode.shape = Result.ok(solidShape);

            const wireShape = createMockWire();
            const wire = rs.fn((_edges: any[]) => Result.ok(wireShape as any));
            const sweep = rs.fn((_profiles: IShape[], _path: IShape, _round: boolean) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ wire, sweep });

            const node = new SweepedNode({
                document: doc,
                profileNodeIds: [profileNode.id],
                profileShapeTypes: [ShapeTypes.shape],
                profileIndexes: [-1],
                pathNodeId: pathNode.id,
                pathShapeType: ShapeTypes.edge,
                pathIndex: 0,
                round: false,
            });
            const result = node.generateShape();

            expect(wire).toHaveBeenCalledWith([targetEdge]);
            expect(sweep.mock.calls[0][1]).toBe(wireShape);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            pathNode.shape = Result.ok(solidShape);

            const node = new SweepedNode({
                document: doc,
                profileNodeIds: [profileNode.id],
                profileShapeTypes: [ShapeTypes.shape],
                profileIndexes: [-1],
                pathNodeId: pathNode.id,
                pathShapeType: ShapeTypes.edge,
                pathIndex: 3,
                round: false,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.sweepEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.sweepEdit");
        });
    });

    describe("updateSelection", () => {
        test("should redirect to new profiles, path and round, and recompute", () => {
            const newProfile = new EditableShapeNode({
                document: doc,
                name: "newProfile",
                shape: selfTransforming(createMockWire()),
            });
            const newPath = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newProfile, newPath);
            const sweep = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ sweep });
            const node = makeNode(false);
            expect(node.shape.isOk).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(1);

            node.updateSelection(
                [{ nodeId: newProfile.id, shapeType: ShapeTypes.shape, index: -1 }],
                { nodeId: newPath.id, shapeType: ShapeTypes.shape, index: -1 },
                true,
            );

            expect(node.profileNodeIds).toEqual([newProfile.id]);
            expect(node.pathNodeId).toBe(newPath.id);
            expect(node.round).toBe(true);
            expect(sweep).toHaveBeenCalledTimes(2);
        });
    });
});

describe("sweepRefFromPick", () => {
    test("should treat the pick as whole-shape when the picked type matches the owner's own shape type", () => {
        const owner = { id: "owner-1", shape: Result.ok(createMockShape({ shapeType: ShapeTypes.wire })) };
        const ref = sweepRefFromPick(owner as any, { shapeType: ShapeTypes.wire } as any);
        expect(ref).toEqual({ nodeId: "owner-1", shapeType: ShapeTypes.shape, index: -1 });
    });

    test("should resolve a sub-shape pick with no .index (e.g. a face's single outer wire) via findSubShapes + isEqual, not a defined .index field", () => {
        // Regression: a SelectShapeStep narrower than the owner's own shape
        // type (e.g. vertex|wire|edge, picking a profile off a face) can
        // return a sub-shape with no `.index` set when there's only one of
        // its kind - trusting `.index !== undefined` to mean "this is a
        // sub-shape" silently fell back to the owner's whole (wrong-typed)
        // shape in that case.
        const pickedWire: any = { shapeType: ShapeTypes.wire, isEqual: (o: unknown) => o === pickedWire };
        const owner = {
            id: "owner-1",
            shape: Result.ok(
                createMockShape({
                    shapeType: ShapeTypes.face,
                    findSubShapes: (type: number) => (type === ShapeTypes.wire ? [pickedWire] : []),
                }),
            ),
        };
        const ref = sweepRefFromPick(owner as any, pickedWire);
        expect(ref).toEqual({ nodeId: "owner-1", shapeType: ShapeTypes.wire, index: 0 });
    });

    test("should return index -1 when the picked sub-shape can't be located in the owner's own findSubShapes list", () => {
        const pickedEdge: any = { shapeType: ShapeTypes.edge, isEqual: () => false };
        const owner = {
            id: "owner-1",
            shape: Result.ok(createMockShape({ shapeType: ShapeTypes.solid, findSubShapes: () => [] })),
        };
        const ref = sweepRefFromPick(owner as any, pickedEdge);
        expect(ref).toEqual({ nodeId: "owner-1", shapeType: ShapeTypes.edge, index: -1 });
    });

    test("should treat the pick as whole-shape when the owner's own shape is an error", () => {
        const owner = { id: "owner-1", shape: Result.err("no shape") };
        const ref = sweepRefFromPick(owner as any, { shapeType: ShapeTypes.wire } as any);
        expect(ref).toEqual({ nodeId: "owner-1", shapeType: ShapeTypes.shape, index: -1 });
    });
});
