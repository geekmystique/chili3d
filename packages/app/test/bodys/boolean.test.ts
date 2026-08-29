// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type INode, Result, Serializer } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { BooleanNode } from "../../src/bodys/boolean";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("BooleanNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let baseNode: EditableShapeNode;
    let toolNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        baseNode = new EditableShapeNode({ document: doc, name: "base", shape: createMockShape() });
        toolNode = new EditableShapeNode({ document: doc, name: "tool", shape: createMockShape() });
        nodes.push(baseNode, toolNode);
    });

    function makeNode(operateType: "common" | "cut" | "fuse" = "fuse") {
        return new BooleanNode({
            document: doc,
            operateType,
            baseNodeId: baseNode.id,
            toolNodeIds: [toolNode.id],
        });
    }

    describe("constructor", () => {
        test("should initialize operateType/baseNodeId/toolNodeIds", () => {
            const node = makeNode("cut");
            expect(node.operateType).toBe("cut");
            expect(node.baseNodeId).toBe(baseNode.id);
            expect(node.toolNodeIds).toEqual([toolNode.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.bolean 1");
        });
    });

    describe("display", () => {
        test("should return body.bolean", () => {
            expect(makeNode().display()).toBe("body.bolean");
        });
    });

    describe("generateShape", () => {
        test("should resolve the base and tool nodes and call the matching shapeFactory op", () => {
            const resultShape = createMockShape();
            const fuse = (_shapes: unknown[], _tools: unknown[]) => Result.ok(resultShape);
            setupShapeFactoryMock({ booleanFuse: fuse });

            const node = makeNode("fuse");
            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(resultShape);
        });

        test("should call booleanCut for the cut operate type", () => {
            let called: unknown[] | undefined;
            setupShapeFactoryMock({
                booleanCut: (shapes: unknown[], tools: unknown[]) => {
                    called = [shapes, tools];
                    return Result.ok(createMockShape());
                },
            });

            makeNode("cut").generateShape();

            expect(called).toBeDefined();
        });

        test("should return an error when the base node no longer exists", () => {
            nodes = [toolNode];
            const node = makeNode();
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should return an error when a tool node no longer exists", () => {
            nodes = [baseNode];
            const node = makeNode();
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(toolNode.id);
        });

        test("should recompute when the base node's shape changes", () => {
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            baseNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(2);
        });

        test("should recompute when a tool node's shape changes", () => {
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            toolNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(2);
        });

        test("should not recompute after being disposed", () => {
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            node.dispose();
            baseNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(1);
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
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.baseNodeId).toBe(newBase.id);
            expect(calls).toBe(2);
        });

        test("should redirect a matching toolNodeIds entry and recompute", () => {
            const newTool = new EditableShapeNode({
                document: doc,
                name: "newTool",
                shape: createMockShape(),
            });
            nodes.push(newTool);
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            const changed = node.redirectReference(toolNode.id, newTool.id);

            expect(changed).toBe(true);
            expect(node.toolNodeIds).toEqual([newTool.id]);
            expect(calls).toBe(2);
        });

        test("should return false and leave state untouched when the id matches neither base nor a tool", () => {
            setupShapeFactoryMock({ booleanFuse: () => Result.ok(createMockShape()) });
            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.baseNodeId).toBe(baseNode.id);
            expect(node.toolNodeIds).toEqual([toolNode.id]);
        });
    });

    describe("primaryInputId", () => {
        test("should be the baseNodeId, not a tool", () => {
            setupShapeFactoryMock({ booleanFuse: () => Result.ok(createMockShape()) });
            const node = makeNode("fuse");

            expect(node.primaryInputId).toBe(baseNode.id);
        });
    });

    describe("serialization", () => {
        test("should round-trip operateType/baseNodeId/toolNodeIds", () => {
            const node = makeNode("common");
            const serialized = Serializer.serializeObject(node);

            expect(serialized["operateType"]).toBe("common");
            expect(serialized["baseNodeId"]).toBe(baseNode.id);
            expect(serialized["toolNodeIds"]).toEqual([toolNode.id]);

            const restored = Serializer.deserializeObject(doc, serialized) as BooleanNode;
            expect(restored.operateType).toBe("common");
            expect(restored.baseNodeId).toBe(baseNode.id);
            expect(restored.toolNodeIds).toEqual([toolNode.id]);
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.booleanEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.booleanEdit");
        });
    });

    describe("updateSelection", () => {
        test("should redirect base and tools, and recompute", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: createMockShape(),
            });
            const newTool = new EditableShapeNode({
                document: doc,
                name: "newTool",
                shape: createMockShape(),
            });
            nodes.push(newBase, newTool);
            let calls = 0;
            setupShapeFactoryMock({
                booleanFuse: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            const node = makeNode("fuse");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            node.updateSelection(newBase.id, [newTool.id]);

            expect(node.baseNodeId).toBe(newBase.id);
            expect(node.toolNodeIds).toEqual([newTool.id]);
            expect(calls).toBe(2);
        });
    });
});
