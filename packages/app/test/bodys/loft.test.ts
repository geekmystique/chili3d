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
import { LoftNode } from "../../src/bodys/loft";
import { createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by LoftNode.generateShape()
 * on each resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType overrides the
 * test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("LoftNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let sectionANode: EditableShapeNode;
    let sectionBNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        sectionANode = new EditableShapeNode({
            document: doc,
            name: "sectionA",
            shape: selfTransforming(createMockWire()),
        });
        sectionBNode = new EditableShapeNode({
            document: doc,
            name: "sectionB",
            shape: selfTransforming(createMockWire()),
        });
        nodes.push(sectionANode, sectionBNode);
    });

    function makeNode(isSolid = false) {
        return new LoftNode({
            document: doc,
            sectionNodeIds: [sectionANode.id, sectionBNode.id],
            sectionShapeTypes: [ShapeTypes.shape, ShapeTypes.shape],
            sectionIndexes: [-1, -1],
            isSolid,
            isRuled: false,
            continuity: "c0",
        });
    }

    describe("constructor", () => {
        test("should initialize section references and options", () => {
            const node = makeNode(true);
            expect(node.sectionNodeIds).toEqual([sectionANode.id, sectionBNode.id]);
            expect(node.isSolid).toBe(true);
            expect(node.isRuled).toBe(false);
            expect(node.continuity).toBe("c0");
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.loft");
        });
    });

    describe("display", () => {
        test("should return body.loft", () => {
            expect(makeNode().display()).toBe("body.loft");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching sectionNodeIds entry and recompute", () => {
            const newSection = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newSection);
            const loft = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ loft });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            expect(loft).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(sectionANode.id, newSection.id);

            expect(changed).toBe(true);
            expect(node.sectionNodeIds).toEqual([newSection.id, sectionBNode.id]);
            expect(loft).toHaveBeenCalledTimes(2);
        });

        test("should return false and leave sectionNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ loft: () => Result.ok(createMockShape()) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sectionNodeIds).toEqual([sectionANode.id, sectionBNode.id]);
        });
    });

    describe("primaryInputId", () => {
        test("should be the first sectionNodeIds entry", () => {
            setupShapeFactoryMock({ loft: () => Result.ok(createMockShape()) });
            const node = makeNode();

            expect(node.primaryInputId).toBe(sectionANode.id);
        });
    });

    describe("setters", () => {
        test("setting isSolid should update value and regenerate the shape", () => {
            const loft = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ loft });
            const node = makeNode(false);
            expect(node.shape.isOk).toBe(true);
            expect(loft).toHaveBeenCalledTimes(1);

            node.isSolid = true;

            expect(node.isSolid).toBe(true);
            expect(loft).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on isRuled change", () => {
            setupShapeFactoryMock({ loft: () => Result.ok(createMockShape()) });
            const node = makeNode();
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.isRuled = true;
            expect(handler.mock.calls.map((c) => c[0])).toContain("isRuled");
        });
    });

    describe("generateShape", () => {
        test("should return an error when a section node no longer exists", () => {
            nodes = [sectionANode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(sectionBNode.id);
        });

        test("should recompute when a section node's shape changes", () => {
            setupShapeFactoryMock({ loft: () => Result.ok(createMockShape()) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                loft: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            sectionANode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ loft: () => Result.ok(createMockShape()) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                loft: () => {
                    calls++;
                    return Result.ok(createMockShape());
                },
            });
            sectionANode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(0);
        });

        test("should call shapeFactory.loft with the resolved sections and options", () => {
            const loft = rs.fn((_sections: IShape[], _isSolid: boolean, _isRuled: boolean, _cont: string) =>
                Result.ok(createMockShape()),
            );
            setupShapeFactoryMock({ loft });
            const result = new LoftNode({
                document: doc,
                sectionNodeIds: [sectionANode.id, sectionBNode.id],
                sectionShapeTypes: [ShapeTypes.shape, ShapeTypes.shape],
                sectionIndexes: [-1, -1],
                isSolid: true,
                isRuled: true,
                continuity: "g1",
            }).generateShape();
            expect(loft).toHaveBeenCalledTimes(1);
            expect(loft.mock.calls[0][0]).toEqual([sectionANode.shape.value, sectionBNode.shape.value]);
            expect(loft.mock.calls[0][1]).toBe(true);
            expect(loft.mock.calls[0][2]).toBe(true);
            expect(loft.mock.calls[0][3]).toBe("g1");
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.loft fails", () => {
            setupShapeFactoryMock({ loft: () => Result.err("loft failed") });
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape sections (e.g. a face of an existing solid)", () => {
        test("should resolve the sub-shape at the matching sectionIndexes entry via findSubShapes", () => {
            const targetEdge: any = { shapeType: ShapeTypes.edge };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.edge ? [targetEdge] : []);
            sectionANode.shape = Result.ok(solidShape);

            const loft = rs.fn((_sections: IShape[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ loft });

            const node = new LoftNode({
                document: doc,
                sectionNodeIds: [sectionANode.id, sectionBNode.id],
                sectionShapeTypes: [ShapeTypes.edge, ShapeTypes.shape],
                sectionIndexes: [0, -1],
                isSolid: false,
                isRuled: false,
                continuity: "c0",
            });
            const result = node.generateShape();

            expect(loft.mock.calls[0][0][0]).toBe(targetEdge);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            sectionANode.shape = Result.ok(solidShape);

            const node = new LoftNode({
                document: doc,
                sectionNodeIds: [sectionANode.id, sectionBNode.id],
                sectionShapeTypes: [ShapeTypes.edge, ShapeTypes.shape],
                sectionIndexes: [3, -1],
                isSolid: false,
                isRuled: false,
                continuity: "c0",
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.loftEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.loftEdit");
        });
    });

    describe("updateSections", () => {
        test("should redirect to a new set of sections and options, and recompute", () => {
            const newSection = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newSection);
            const loft = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ loft });
            const node = makeNode(false);
            expect(node.shape.isOk).toBe(true);
            expect(loft).toHaveBeenCalledTimes(1);

            node.updateSections([newSection.id], [ShapeTypes.shape], [-1], true, true, "g1");

            expect(node.sectionNodeIds).toEqual([newSection.id]);
            expect(node.isSolid).toBe(true);
            expect(node.isRuled).toBe(true);
            expect(node.continuity).toBe("g1");
            expect(loft).toHaveBeenCalledTimes(2);
        });
    });
});
