// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type INode, Matrix4, Result } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PlacementNode } from "../../src/bodys/placement";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("PlacementNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let baseNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        baseNode = new EditableShapeNode({ document: doc, name: "base", shape: createMockShape() });
        nodes.push(baseNode);
    });

    function makeNode(kind: "move" | "rotate" | "mirror" = "move", delta = Matrix4.fromTranslation(1, 2, 3)) {
        return new PlacementNode({ document: doc, baseNodeId: baseNode.id, kind, delta });
    }

    describe("constructor", () => {
        test("should initialize baseNodeId, kind and delta", () => {
            const delta = Matrix4.fromTranslation(5, 0, 0);
            const node = makeNode("rotate", delta);
            expect(node.baseNodeId).toBe(baseNode.id);
            expect(node.kind).toBe("rotate");
            expect(node.delta).toBe(delta);
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.placement");
        });
    });

    describe("display", () => {
        test("should return body.placement", () => {
            expect(makeNode().display()).toBe("body.placement");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.placementMoveEdit for kind 'move'", () => {
            expect(makeNode("move").editCommandKey).toBe("modify.placementMoveEdit");
        });

        test("should be modify.placementRotateEdit for kind 'rotate'", () => {
            expect(makeNode("rotate").editCommandKey).toBe("modify.placementRotateEdit");
        });

        test("should be modify.placementMirrorEdit for kind 'mirror'", () => {
            expect(makeNode("mirror").editCommandKey).toBe("modify.placementMirrorEdit");
        });
    });

    describe("redirectReference", () => {
        test("should redirect baseNodeId and recompute when it matches", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: createMockShape(),
            });
            nodes.push(newBase);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.baseNodeId).toBe(newBase.id);
        });

        test("should return false and leave baseNodeId untouched when the id doesn't match", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.baseNodeId).toBe(baseNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the baseNodeId", () => {
            expect(makeNode().primaryInputId).toBe(baseNode.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when the base node no longer exists", () => {
            nodes = [];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should apply the delta to the base's own shape", () => {
            const delta = Matrix4.fromTranslation(1, 2, 3);
            const node = makeNode("move", delta);
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
        });

        test("should recompute when the base node's shape changes", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            const initial = node.shape.value;

            baseNode.shape = Result.ok(createMockShape());

            expect(node.shape.value).not.toBe(initial);
        });

        test("should not recompute after being disposed", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            const original = node.generateShape.bind(node);
            (node as any).generateShape = () => {
                calls++;
                return original();
            };
            baseNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(0);
        });
    });

    describe("updateDelta", () => {
        test("should replace the delta and recompute", () => {
            const node = makeNode("move", Matrix4.fromTranslation(1, 0, 0));
            expect(node.shape.isOk).toBe(true);

            const newDelta = Matrix4.fromTranslation(9, 9, 9);
            node.updateDelta(newDelta);

            expect(node.delta).toBe(newDelta);
            expect(node.shape.isOk).toBe(true);
        });
    });
});
