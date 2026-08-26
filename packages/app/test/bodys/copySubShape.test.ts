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
import { beforeEach, describe, expect, test } from "@rstest/core";
import { CopySubShapeNode } from "../../src/bodys/copySubShape";
import { createMockShape } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by CopySubShapeNode.generateShape()
 * on the resolved source shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType/findSubShapes
 * overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("CopySubShapeNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let sourceShape: any;
    let sourceNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        sourceShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.edge }));
        sourceNode = new EditableShapeNode({ document: doc, name: "source", shape: sourceShape });
        nodes.push(sourceNode);
    });

    function makeNode() {
        return new CopySubShapeNode({
            document: doc,
            sourceNodeId: sourceNode.id,
            subShapeType: ShapeTypes.shape,
            index: -1,
        });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeId, subShapeType, and index", () => {
            const node = makeNode();
            expect(node.sourceNodeId).toBe(sourceNode.id);
            expect(node.subShapeType).toBe(ShapeTypes.shape);
            expect(node.index).toBe(-1);
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.copySubShape");
        });
    });

    describe("display", () => {
        test("should return body.copySubShape", () => {
            expect(makeNode().display()).toBe("body.copySubShape");
        });
    });

    describe("redirectReference", () => {
        test("should redirect sourceNodeId and recompute when it matches", () => {
            const newSource = new EditableShapeNode({
                document: doc,
                name: "newSource",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })),
            });
            nodes.push(newSource);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(sourceNode.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeId).toBe(newSource.id);
        });

        test("should return false and leave sourceNodeId untouched when the id doesn't match", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sourceNodeId).toBe(sourceNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the sourceNodeId", () => {
            const node = makeNode();
            expect(node.primaryInputId).toBe(sourceNode.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when the source node no longer exists", () => {
            nodes = [];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(sourceNode.id);
        });

        test("should resolve to the source's own shape for a whole-shape reference", () => {
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(true);
            expect(result.value).toBe(sourceShape);
        });

        test("should recompute when the source node's shape changes", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            const initial = node.shape.value;

            sourceNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })));

            expect(node.shape.value).not.toBe(initial);
        });

        test("should not recompute after being disposed", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            const newShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.edge }));
            (newShape as unknown as { transformedMul: () => IShape }).transformedMul = () => {
                calls++;
                return newShape;
            };
            sourceNode.shape = Result.ok(newShape);

            expect(calls).toBe(0);
        });
    });

    describe("sub-shape references (e.g. one face of a multi-face pick)", () => {
        test("should resolve the sub-shape at index via findSubShapes", () => {
            const targetFace: any = { shapeType: ShapeTypes.face };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            sourceNode.shape = Result.ok(solidShape);

            const node = new CopySubShapeNode({
                document: doc,
                sourceNodeId: sourceNode.id,
                subShapeType: ShapeTypes.face,
                index: 0,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(targetFace);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            sourceNode.shape = Result.ok(solidShape);

            const node = new CopySubShapeNode({
                document: doc,
                sourceNodeId: sourceNode.id,
                subShapeType: ShapeTypes.face,
                index: 4,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("4");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.copySubShapeEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.copySubShapeEdit");
        });
    });

    describe("updateSelection", () => {
        test("should redirect to a new source sub-shape and recompute", () => {
            const newSource = new EditableShapeNode({
                document: doc,
                name: "newSource",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })),
            });
            nodes.push(newSource);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.updateSelection(newSource.id, ShapeTypes.shape, -1);

            expect(node.sourceNodeId).toBe(newSource.id);
            expect(node.shape.isOk).toBe(true);
            expect(node.shape.value).toBe(newSource.shape.value);
        });
    });
});
