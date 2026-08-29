// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type INode, type IShape, Result } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CompoundNode } from "../../src/bodys/compound";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by CompoundNode.generateShape()
 * on each resolved source shape) returns itself instead of a fresh,
 * override-less instance - preserving whatever overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("CompoundNode", () => {
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
        return new CompoundNode({ document: doc, sourceNodeIds: shapes.map((s) => sourceNode(s).id) });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeIds", () => {
            const a = sourceNode(createMockShape());
            const b = sourceNode(createMockShape());
            const node = new CompoundNode({ document: doc, sourceNodeIds: [a.id, b.id] });
            expect(node.sourceNodeIds).toEqual([a.id, b.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode(createMockShape()).name).toBe("body.compound 1");
        });
    });

    describe("display", () => {
        test("should return body.compound", () => {
            expect(makeNode(createMockShape()).display()).toBe("body.compound");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching source id and recompute", () => {
            setupShapeFactoryMock({ combine: () => Result.ok(createMockShape()) });
            const a = sourceNode(createMockShape());
            const b = sourceNode(createMockShape());
            const newSource = sourceNode(createMockShape());
            const node = new CompoundNode({ document: doc, sourceNodeIds: [a.id, b.id] });
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(b.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeIds).toEqual([a.id, newSource.id]);
        });

        test("should return false and leave sourceNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ combine: () => Result.ok(createMockShape()) });
            const node = makeNode(createMockShape());
            const before = node.sourceNodeIds;

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sourceNodeIds).toEqual(before);
        });
    });

    describe("primaryInputId", () => {
        test("should be the first source node id", () => {
            const a = sourceNode(createMockShape());
            const b = sourceNode(createMockShape());
            const node = new CompoundNode({ document: doc, sourceNodeIds: [a.id, b.id] });

            expect(node.primaryInputId).toBe(a.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when a source node no longer exists", () => {
            const node = new CompoundNode({ document: doc, sourceNodeIds: ["missing-id"] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("missing-id");
        });

        test("should call shapeFactory.combine with the resolved shapes", () => {
            const a = createMockShape();
            const b = createMockShape();
            const combine = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ combine });
            makeNode(a, b).generateShape();
            expect(combine).toHaveBeenCalledWith([a, b]);
        });

        test("should recompute when a source node's shape changes", () => {
            setupShapeFactoryMock({ combine: () => Result.ok(createMockShape()) });
            const source = sourceNode(createMockShape());
            const node = new CompoundNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                combine: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(createMockShape()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ combine: () => Result.ok(createMockShape()) });
            const source = sourceNode(createMockShape());
            const node = new CompoundNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                combine: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(createMockShape()));

            expect(calls).toBe(0);
        });

        test("should return Result.err when shapeFactory.combine fails", () => {
            setupShapeFactoryMock({ combine: () => Result.err("combine failed") });
            const result = makeNode(createMockShape()).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.compoundEdit", () => {
            expect(makeNode(createMockShape()).editCommandKey).toBe("modify.compoundEdit");
        });
    });

    describe("updateSources", () => {
        test("should redirect to a new set of sources and recompute", () => {
            const combine = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ combine });
            const node = makeNode(createMockShape());
            expect(node.shape.isOk).toBe(true);
            expect(combine).toHaveBeenCalledTimes(1);

            const newSource = sourceNode(createMockShape());
            node.updateSources([newSource.id]);

            expect(node.sourceNodeIds).toEqual([newSource.id]);
            expect(combine).toHaveBeenCalledTimes(2);
        });
    });
});
