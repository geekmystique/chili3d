// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type INode, type IShape, Result } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { WireNode } from "../../src/bodys/wire";
import { createMockEdge, createMockWire, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by WireNode.generateShape() on
 * each resolved source shape) returns itself instead of a fresh, override-less
 * instance - preserving whatever shapeType/findSubShapes overrides the test
 * set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("WireNode", () => {
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
        return new WireNode({ document: doc, sourceNodeIds: shapes.map((s) => sourceNode(s).id) });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeIds", () => {
            const edge = sourceNode(createMockEdge());
            const wire = sourceNode(createMockWire());
            const node = new WireNode({ document: doc, sourceNodeIds: [edge.id, wire.id] });
            expect(node.sourceNodeIds).toEqual([edge.id, wire.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode(createMockEdge()).name).toBe("body.wire");
        });
    });

    describe("display", () => {
        test("should return body.wire", () => {
            expect(makeNode(createMockEdge()).display()).toBe("body.wire");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching source id and recompute", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire()) });
            const edgeA = sourceNode(createMockEdge());
            const edgeB = sourceNode(createMockEdge());
            const newSource = sourceNode(createMockEdge());
            const node = new WireNode({ document: doc, sourceNodeIds: [edgeA.id, edgeB.id] });
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(edgeB.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeIds).toEqual([edgeA.id, newSource.id]);
        });

        test("should return false and leave sourceNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire()) });
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
            const node = new WireNode({ document: doc, sourceNodeIds: [edgeA.id, edgeB.id] });

            expect(node.primaryInputId).toBe(edgeA.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when a source node no longer exists", () => {
            const node = new WireNode({ document: doc, sourceNodeIds: ["missing-id"] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("missing-id");
        });

        test("should call shapeFactory.wire with the resolved edges", () => {
            const wire = rs.fn(() => Result.ok(createMockWire()));
            setupShapeFactoryMock({ wire });
            const edge = createMockEdge();
            const node = makeNode(edge);
            node.generateShape();
            expect(wire).toHaveBeenCalledWith([edge]);
        });

        test("should flatten a wire source into its edges", () => {
            const edgeA = createMockEdge();
            const edgeB = createMockEdge();
            const flatWire = Object.assign(createMockWire(), {
                findSubShapes: () => [edgeA, edgeB],
            });
            const wire = rs.fn(() => Result.ok(createMockWire()));
            setupShapeFactoryMock({ wire });
            const node = makeNode(flatWire);
            node.generateShape();
            expect(wire).toHaveBeenCalledWith([edgeA, edgeB]);
        });

        test("should recompute when a source node's shape changes", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire()) });
            const source = sourceNode(createMockEdge());
            const node = new WireNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                wire: () => {
                    calls++;
                    return Result.ok(createMockWire());
                },
            });
            source.shape = Result.ok(selfTransforming(createMockEdge()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire()) });
            const source = sourceNode(createMockEdge());
            const node = new WireNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                wire: () => {
                    calls++;
                    return Result.ok(createMockWire());
                },
            });
            source.shape = Result.ok(selfTransforming(createMockEdge()));

            expect(calls).toBe(0);
        });

        test("should return Result.err when shapeFactory.wire fails", () => {
            setupShapeFactoryMock({
                wire: () => Result.err("wire creation failed"),
            });
            const result = makeNode(createMockEdge()).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.wireEdit", () => {
            expect(makeNode(createMockEdge()).editCommandKey).toBe("modify.wireEdit");
        });
    });

    describe("updateSources", () => {
        test("should redirect to a new set of sources and recompute", () => {
            const wire = rs.fn(() => Result.ok(createMockWire()));
            setupShapeFactoryMock({ wire });
            const node = makeNode(createMockEdge());
            expect(node.shape.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(1);

            const newSource = sourceNode(createMockEdge());
            node.updateSources([newSource.id]);

            expect(node.sourceNodeIds).toEqual([newSource.id]);
            expect(wire).toHaveBeenCalledTimes(2);
        });
    });
});
