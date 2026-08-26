// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    type IWire,
    Result,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, createMockEdgeCurve } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { FaceNode } from "../../src/bodys/face";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

function mockLineEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    return createMockEdge({
        curve: createMockEdgeCurve({
            start: new XYZ({ x: x1, y: y1, z: 0 }),
            end: new XYZ({ x: x2, y: y2, z: 0 }),
            valueFn: (t: number) => new XYZ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, z: 0 }),
        }),
        ends: () => [new XYZ({ x: x1, y: y1, z: 0 }), new XYZ({ x: x2, y: y2, z: 0 })],
    }) as unknown as IEdge;
}

// FaceNode uses closed wires directly, so the wire mocks in these tests must report
// isClosed() = true and expose their edges (the shared createMockWire() is unclosed).
function mockClosedWire(...edges: IEdge[]) {
    return Object.assign(createMockWire(), {
        isClosed: () => true,
        findSubShapes: (_type: unknown) => edges,
    });
}

/**
 * Patch a mock shape so transformedMul (called by FaceNode.generateShape() on
 * each resolved source shape) returns itself instead of a fresh, override-less
 * instance - preserving whatever shapeType/findSubShapes overrides the test
 * set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("FaceNode", () => {
    let doc: IDocument;
    let nodes: INode[];

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
    });

    function sourceNode(shape: IShape) {
        const node = new EditableShapeNode({ document: doc, name: "src", shape: selfTransforming(shape) });
        nodes.push(node);
        return node;
    }

    function makeNode(...shapes: IShape[]) {
        return new FaceNode({ document: doc, sourceNodeIds: shapes.map((s) => sourceNode(s).id) });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeIds", () => {
            const edge = sourceNode(createMockEdge());
            const wire = sourceNode(createMockWire());
            const node = new FaceNode({ document: doc, sourceNodeIds: [edge.id, wire.id] });
            expect(node.sourceNodeIds).toEqual([edge.id, wire.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode(createMockEdge()).name).toBe("body.face");
        });

        test("should accept an empty sourceNodeIds array", () => {
            const node = new FaceNode({ document: doc, sourceNodeIds: [] });
            expect(node.sourceNodeIds.length).toBe(0);
        });
    });

    describe("display", () => {
        test("should return body.face", () => {
            expect(makeNode(createMockEdge()).display()).toBe("body.face");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching source id and recompute", () => {
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(createMockShape()),
            });
            const edgeA = sourceNode(mockLineEdge(0, 0, 10, 0));
            const edgeB = sourceNode(mockLineEdge(10, 0, 10, 10));
            const newSource = sourceNode(mockLineEdge(10, 0, 10, 10));
            const node = new FaceNode({ document: doc, sourceNodeIds: [edgeA.id, edgeB.id] });
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(edgeB.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeIds).toEqual([edgeA.id, newSource.id]);
        });

        test("should return false and leave sourceNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(createMockShape()),
            });
            const node = makeNode(createMockEdge());
            const before = node.sourceNodeIds;

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sourceNodeIds).toEqual(before);
        });
    });

    describe("primaryInputId", () => {
        test("should be the first source node id", () => {
            const edgeA = sourceNode(createMockEdge());
            const edgeB = sourceNode(createMockEdge());
            const node = new FaceNode({ document: doc, sourceNodeIds: [edgeA.id, edgeB.id] });

            expect(node.primaryInputId).toBe(edgeA.id);
        });
    });

    describe("generateShape", () => {
        test("should return error when sourceNodeIds is empty", () => {
            const node = new FaceNode({ document: doc, sourceNodeIds: [] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should return an error when a source node no longer exists", () => {
            const node = new FaceNode({ document: doc, sourceNodeIds: ["missing-id"] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("missing-id");
        });

        test("should call shapeFactory.wire and shapeFactory.face for closed edges", () => {
            const mockWire = createMockWire();
            const faceShape = createMockShape();
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(mockWire));
            const face = rs.fn((_wires: IWire[]) => Result.ok(faceShape));
            setupShapeFactoryMock({ wire, face });
            const result = makeNode(mockLineEdge(0, 0, 10, 0)).generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(1);
            expect(wire.mock.calls[0][0].length).toBe(1);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(1);
        });

        test("should group disjoint edge loops into separate wires", () => {
            const mockWire = createMockWire();
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(mockWire));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ wire, face });
            // two disjoint rectangles, edges interleaved and unordered
            const outer = [
                mockLineEdge(0, 0, 100, 0),
                mockLineEdge(100, 0, 100, 100),
                mockLineEdge(100, 100, 0, 100),
                mockLineEdge(0, 100, 0, 0),
            ] as unknown as IEdge[];
            const inner = [
                mockLineEdge(10, 10, 90, 10),
                mockLineEdge(90, 10, 90, 90),
                mockLineEdge(90, 90, 10, 90),
                mockLineEdge(10, 90, 10, 10),
            ] as unknown as IEdge[];
            const shapes = [outer[0], inner[0], outer[1], inner[1], inner[2], outer[2], inner[3], outer[3]];
            const result = makeNode(...shapes).generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(2);
            const groups = wire.mock.calls.map((c) => c[0] as IEdge[]);
            expect(groups.every((g) => g.length === 4)).toBe(true);
            const [first, second] = groups;
            expect(outer.every((e) => first.includes(e)) || outer.every((e) => second.includes(e))).toBe(
                true,
            );
            expect(inner.every((e) => first.includes(e)) || inner.every((e) => second.includes(e))).toBe(
                true,
            );
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(2);
        });

        test("should combine wires with grouped edge loops", () => {
            const existingWire = mockClosedWire(mockLineEdge(0, 0, 100, 0), mockLineEdge(100, 0, 100, 100));
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(createMockWire()));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ wire, face });
            const result = makeNode(
                existingWire,
                mockLineEdge(0, 0, 10, 0),
                mockLineEdge(10, 0, 10, 10),
            ).generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(1);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(2);
            expect(face.mock.calls[0][0][0]).toBe(existingWire);
        });

        test("should use wire shapes directly without creating new wire", () => {
            const mockWire = mockClosedWire(mockLineEdge(0, 0, 10, 0), mockLineEdge(10, 0, 10, 10));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ face });
            const result = makeNode(mockWire).generateShape();
            expect(result.isOk).toBe(true);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(1);
        });

        test("should throw error when wire from unclosed edges fails", () => {
            setupShapeFactoryMock({
                wire: () => Result.err("cannot create wire"),
            });
            expect(() => makeNode(mockLineEdge(0, 0, 10, 0)).generateShape()).toThrow(
                "Cannot create wire from open shapes",
            );
        });

        test("should recompute when a source node's shape changes", () => {
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(createMockShape()),
            });
            const source = sourceNode(mockLineEdge(0, 0, 10, 0));
            const node = new FaceNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockLineEdge(0, 0, 10, 0)));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(createMockShape()),
            });
            const source = sourceNode(mockLineEdge(0, 0, 10, 0));
            const node = new FaceNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockLineEdge(0, 0, 10, 0)));

            expect(calls).toBe(0);
        });
    });
});
