// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type INode,
    type IShape,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { OffsetNode } from "../../src/bodys/offset";
import { createMockShape } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by OffsetNode.generateShape()
 * on the resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance, and stub an `offset` method so the shape
 * can act as the section.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("OffsetNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let section: any;
    let baseNode: EditableShapeNode;
    let normal: XYZ;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        section = selfTransforming(
            createMockShape({ shapeType: ShapeTypes.edge, offset: () => Result.ok(createMockShape()) }),
        );
        baseNode = new EditableShapeNode({ document: doc, name: "section", shape: section });
        nodes.push(baseNode);
        normal = XYZ.unitZ;
    });

    function makeNode(distance = 5) {
        return new OffsetNode({
            document: doc,
            sectionNodeId: baseNode.id,
            distance,
            normal,
            joinType: "arc",
        });
    }

    describe("constructor", () => {
        test("should initialize sectionNodeId, distance, normal, and joinType", () => {
            const node = makeNode(15);
            expect(node.sectionNodeId).toBe(baseNode.id);
            expect(node.distance).toBe(15);
            expect(node.normal).toBe(normal);
            expect(node.joinType).toBe("arc");
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
        });

        test("should set name from display()", () => {
            expect(makeNode(5).name).toBe("body.offset 1");
        });
    });

    describe("display", () => {
        test("should return body.offset", () => {
            expect(makeNode(5).display()).toBe("body.offset");
        });
    });

    describe("redirectReference", () => {
        test("should redirect sectionNodeId and recompute when it matches", () => {
            const offsetForNewBase = rs.fn(() => Result.ok(createMockShape()));
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: selfTransforming(
                    createMockShape({ shapeType: ShapeTypes.edge, offset: offsetForNewBase }),
                ),
            });
            nodes.push(newBase);
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.sectionNodeId).toBe(newBase.id);
            expect(offsetForNewBase).toHaveBeenCalledTimes(1);
        });

        test("should return false and leave sectionNodeId untouched when the id doesn't match", () => {
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sectionNodeId).toBe(baseNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the sectionNodeId", () => {
            const node = makeNode(5);

            expect(node.primaryInputId).toBe(baseNode.id);
        });
    });

    describe("setters", () => {
        test("setting distance should update value and regenerate the shape", () => {
            const offset = rs.fn(() => Result.ok(createMockShape()));
            section.offset = offset;
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);
            expect(offset).toHaveBeenCalledTimes(1);

            node.distance = 20;

            expect(node.distance).toBe(20);
            expect(offset).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on distance change", () => {
            const node = makeNode(5);
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.distance = 9;
            expect(handler.mock.calls.map((c) => c[0])).toContain("distance");
        });
    });

    describe("generateShape", () => {
        test("should return an error when the base node no longer exists", () => {
            nodes = [];
            const result = makeNode(5).generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should recompute when the base node's shape changes", () => {
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            const newSection = selfTransforming(
                createMockShape({
                    shapeType: ShapeTypes.edge,
                    offset: () => {
                        calls++;
                        return Result.ok(createMockShape());
                    },
                }),
            );
            baseNode.shape = Result.ok(newSection);

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            const newSection = selfTransforming(
                createMockShape({
                    shapeType: ShapeTypes.edge,
                    offset: () => {
                        calls++;
                        return Result.ok(createMockShape());
                    },
                }),
            );
            baseNode.shape = Result.ok(newSection);

            expect(calls).toBe(0);
        });

        test("should call edge.offset(distance, normal) for an edge section", () => {
            const offset = rs.fn((_distance: number, _dir: XYZ) => Result.ok(createMockShape()));
            section.offset = offset;
            const result = makeNode(7).generateShape();
            expect(offset).toHaveBeenCalledTimes(1);
            expect(offset.mock.calls[0][0]).toBe(7);
            expect(offset.mock.calls[0][1]).toBe(normal);
            expect(result.isOk).toBe(true);
        });

        test("should call wire.offset(distance, joinType) for a wire section", () => {
            const offset = rs.fn((_distance: number, _joinType: string) => Result.ok(createMockShape()));
            const wireSection = selfTransforming(createMockShape({ shapeType: ShapeTypes.wire, offset }));
            baseNode.shape = Result.ok(wireSection);
            const node = new OffsetNode({
                document: doc,
                sectionNodeId: baseNode.id,
                distance: 4,
                normal,
                joinType: "tangent",
            });
            const result = node.generateShape();
            expect(offset).toHaveBeenCalledWith(4, "tangent");
            expect(result.isOk).toBe(true);
        });

        test("should extract the outer wire before offsetting a face section", () => {
            const offset = rs.fn(() => Result.ok(createMockShape()));
            const outerWire = { shapeType: ShapeTypes.wire, offset };
            const faceSection: any = selfTransforming(
                createMockShape({ shapeType: ShapeTypes.face, outerWire: () => outerWire }),
            );
            baseNode.shape = Result.ok(faceSection);
            const node = new OffsetNode({
                document: doc,
                sectionNodeId: baseNode.id,
                distance: 2,
                normal,
                joinType: "arc",
            });
            const result = node.generateShape();
            expect(offset).toHaveBeenCalledTimes(1);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when the shape's offset() fails", () => {
            section.offset = () => Result.err("offset failed");
            const result = makeNode(5).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape section (e.g. a face of an existing solid)", () => {
        test("should resolve the sub-shape at sectionIndex via findSubShapes and use it as the section", () => {
            const offset = rs.fn(() => Result.ok(createMockShape()));
            const targetEdge: any = { shapeType: ShapeTypes.edge, offset };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.edge ? [targetEdge] : []);
            baseNode.shape = Result.ok(solidShape);

            const node = new OffsetNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.edge,
                sectionIndex: 0,
                distance: 5,
                normal,
                joinType: "arc",
            });
            const result = node.generateShape();

            expect(offset).toHaveBeenCalledTimes(1);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            baseNode.shape = Result.ok(solidShape);

            const node = new OffsetNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.edge,
                sectionIndex: 3,
                distance: 5,
                normal,
                joinType: "arc",
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.offsetEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.offsetEdit");
        });
    });

    describe("updateSection", () => {
        test("should redirect to a new section, normal and joinType, and recompute", () => {
            const newSection = selfTransforming(
                createMockShape({ shapeType: ShapeTypes.edge, offset: () => Result.ok(createMockShape()) }),
            );
            const newBase = new EditableShapeNode({ document: doc, name: "newSection", shape: newSection });
            nodes.push(newBase);
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            const newNormal = XYZ.unitX;
            node.updateSection(newBase.id, undefined, undefined, newNormal, "tangent");

            expect(node.sectionNodeId).toBe(newBase.id);
            expect(node.normal).toBe(newNormal);
            expect(node.joinType).toBe("tangent");
            expect(node.shape.isOk).toBe(true);
        });
    });
});
