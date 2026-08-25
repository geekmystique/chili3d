// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type INode, Result, Serializer } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { EdgeCornerNode } from "../../src/bodys/edgeCorner";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("EdgeCornerNode", () => {
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

    function makeNode(operateType: "fillet" | "chamfer" = "fillet", value = 5) {
        return new EdgeCornerNode({
            document: doc,
            operateType,
            baseNodeId: baseNode.id,
            edgeIndexes: [1, 2],
            value,
        });
    }

    describe("constructor", () => {
        test("should initialize operateType/baseNodeId/edgeIndexes/value", () => {
            const node = makeNode("chamfer", 3);
            expect(node.operateType).toBe("chamfer");
            expect(node.baseNodeId).toBe(baseNode.id);
            expect(node.edgeIndexes).toEqual([1, 2]);
            expect(node.value).toBe(3);
        });

        test("should name a fillet node from display() despite the base class naming it early", () => {
            expect(makeNode("fillet").name).toBe("body.fillet");
        });

        test("should name a chamfer node from display() despite the base class naming it early", () => {
            expect(makeNode("chamfer").name).toBe("body.chamfer");
        });
    });

    describe("display", () => {
        test("should return body.fillet for a fillet node", () => {
            expect(makeNode("fillet").display()).toBe("body.fillet");
        });

        test("should return body.chamfer for a chamfer node", () => {
            expect(makeNode("chamfer").display()).toBe("body.chamfer");
        });
    });

    describe("generateShape", () => {
        test("should resolve the base node and call shapeFactory.fillet", () => {
            const resultShape = createMockShape();
            let called: unknown[] | undefined;
            setupShapeFactoryMock({
                fillet: (shape: unknown, edges: unknown, radius: unknown) => {
                    called = [shape, edges, radius];
                    return Result.ok(resultShape);
                },
            });

            const node = makeNode("fillet", 4);
            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(resultShape);
            expect(called).toEqual([baseNode.shape.value, [1, 2], 4]);
        });

        test("should call shapeFactory.chamfer for the chamfer operate type", () => {
            let called: unknown[] | undefined;
            setupShapeFactoryMock({
                chamfer: (shape: unknown, edges: unknown, distance: unknown) => {
                    called = [shape, edges, distance];
                    return Result.ok(createMockShape());
                },
            });

            makeNode("chamfer", 2).generateShape();

            expect(called).toEqual([baseNode.shape.value, [1, 2], 2]);
        });

        test("should return an error when the base node no longer exists", () => {
            nodes = [];
            const node = makeNode();
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should recompute when the base node's shape changes", () => {
            let calls = 0;
            setupShapeFactoryMock({
                fillet: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fillet");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            baseNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(2);
        });

        test("should not recompute after being disposed", () => {
            let calls = 0;
            setupShapeFactoryMock({
                fillet: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fillet");
            expect(node.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            node.dispose();
            baseNode.shape = Result.ok(createMockShape());

            expect(calls).toBe(1);
        });
    });

    describe("editCommandKey", () => {
        test("should point at the edgeCornerEdit command", () => {
            expect(makeNode().editCommandKey).toBe("modify.edgeCornerEdit");
        });
    });

    describe("updateSelection", () => {
        test("should replace edgeIndexes/value and recompute once, against the new inputs", () => {
            const calls: unknown[][] = [];
            setupShapeFactoryMock({
                fillet: (shape: unknown, edges: unknown, radius: unknown) => {
                    calls.push([shape, edges, radius]);
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fillet", 5);
            expect(node.shape.isOk).toBe(true);
            expect(calls.length).toBe(1);

            node.updateSelection([3, 4], 9);

            expect(node.edgeIndexes).toEqual([3, 4]);
            expect(node.value).toBe(9);
            expect(calls.length).toBe(2);
            expect(calls[1]).toEqual([baseNode.shape.value, [3, 4], 9]);
        });

        test("should propagate to a downstream node referencing it", () => {
            let downstreamCalls = 0;
            setupShapeFactoryMock({
                fillet: () => Result.ok(createMockShape()),
                chamfer: () => {
                    downstreamCalls++;
                    return Result.ok(createMockShape());
                },
            });

            const node = makeNode("fillet", 5);
            nodes.push(node);
            const downstream = new EdgeCornerNode({
                document: doc,
                operateType: "chamfer",
                baseNodeId: node.id,
                edgeIndexes: [0],
                value: 1,
            });
            nodes.push(downstream);

            expect(downstream.shape.isOk).toBe(true);
            expect(downstreamCalls).toBe(1);

            node.updateSelection([3, 4], 9);

            expect(downstreamCalls).toBe(2);
        });
    });

    describe("serialization", () => {
        test("should round-trip operateType/baseNodeId/edgeIndexes/value", () => {
            const node = makeNode("chamfer", 7);
            const serialized = Serializer.serializeObject(node);

            expect(serialized["operateType"]).toBe("chamfer");
            expect(serialized["baseNodeId"]).toBe(baseNode.id);
            expect(serialized["edgeIndexes"]).toEqual([1, 2]);
            expect(serialized["value"]).toBe(7);

            const restored = Serializer.deserializeObject(doc, serialized) as EdgeCornerNode;
            expect(restored.operateType).toBe("chamfer");
            expect(restored.baseNodeId).toBe(baseNode.id);
            expect(restored.edgeIndexes).toEqual([1, 2]);
            expect(restored.value).toBe(7);
        });
    });
});
