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
import { ShellNode } from "../../src/bodys/shell";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by ShellNode.generateShape()
 * on each resolved source shape) returns itself instead of a fresh,
 * override-less instance - preserving whatever overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

function mockFace() {
    return createMockShape({ shapeType: ShapeTypes.face });
}

describe("ShellNode", () => {
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
        return new ShellNode({ document: doc, sourceNodeIds: shapes.map((s) => sourceNode(s).id) });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeIds", () => {
            const faceA = sourceNode(mockFace());
            const faceB = sourceNode(mockFace());
            const node = new ShellNode({ document: doc, sourceNodeIds: [faceA.id, faceB.id] });
            expect(node.sourceNodeIds).toEqual([faceA.id, faceB.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode(mockFace()).name).toBe("body.shell");
        });
    });

    describe("display", () => {
        test("should return body.shell", () => {
            expect(makeNode(mockFace()).display()).toBe("body.shell");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching source id and recompute", () => {
            setupShapeFactoryMock({ shell: () => Result.ok(createMockShape()) });
            const faceA = sourceNode(mockFace());
            const faceB = sourceNode(mockFace());
            const newSource = sourceNode(mockFace());
            const node = new ShellNode({ document: doc, sourceNodeIds: [faceA.id, faceB.id] });
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(faceB.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeIds).toEqual([faceA.id, newSource.id]);
        });

        test("should return false and leave sourceNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ shell: () => Result.ok(createMockShape()) });
            const node = makeNode(mockFace());
            const before = node.sourceNodeIds;

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sourceNodeIds).toEqual(before);
        });
    });

    describe("primaryInputId", () => {
        test("should be the first source node id", () => {
            const faceA = sourceNode(mockFace());
            const faceB = sourceNode(mockFace());
            const node = new ShellNode({ document: doc, sourceNodeIds: [faceA.id, faceB.id] });

            expect(node.primaryInputId).toBe(faceA.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when a source node no longer exists", () => {
            const node = new ShellNode({ document: doc, sourceNodeIds: ["missing-id"] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("missing-id");
        });

        test("should call shapeFactory.shell with the resolved faces", () => {
            const faceA = mockFace();
            const faceB = mockFace();
            const shell = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ shell });
            makeNode(faceA, faceB).generateShape();
            expect(shell).toHaveBeenCalledWith([faceA, faceB]);
        });

        test("should recompute when a source node's shape changes", () => {
            setupShapeFactoryMock({ shell: () => Result.ok(createMockShape()) });
            const source = sourceNode(mockFace());
            const node = new ShellNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                shell: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockFace()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ shell: () => Result.ok(createMockShape()) });
            const source = sourceNode(mockFace());
            const node = new ShellNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                shell: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockFace()));

            expect(calls).toBe(0);
        });

        test("should return Result.err when shapeFactory.shell fails", () => {
            setupShapeFactoryMock({ shell: () => Result.err("shell creation failed") });
            const result = makeNode(mockFace()).generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
