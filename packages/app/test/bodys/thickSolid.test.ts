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
import { ThickSolidNode } from "../../src/bodys/thickSolid";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by ThickSolidNode.generateShape()
 * on the resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType/findSubShapes
 * overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("ThickSolidNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let section: any;
    let baseNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        section = selfTransforming(createMockShape({ shapeType: ShapeTypes.face }));
        baseNode = new EditableShapeNode({ document: doc, name: "section", shape: section });
        nodes.push(baseNode);
    });

    function makeNode(thickness = 5) {
        return new ThickSolidNode({ document: doc, sectionNodeId: baseNode.id, thickness });
    }

    describe("constructor", () => {
        test("should initialize sectionNodeId and thickness", () => {
            const node = makeNode(8);
            expect(node.sectionNodeId).toBe(baseNode.id);
            expect(node.thickness).toBe(8);
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
        });

        test("should set name from display()", () => {
            expect(makeNode(5).name).toBe("body.thickSolid 1");
        });
    });

    describe("display", () => {
        test("should return body.thickSolid", () => {
            expect(makeNode(5).display()).toBe("body.thickSolid");
        });
    });

    describe("redirectReference", () => {
        test("should redirect sectionNodeId and recompute when it matches", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newBase);
            const makeThickSolidBySimple = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ makeThickSolidBySimple });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.sectionNodeId).toBe(newBase.id);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(2);
        });

        test("should return false and leave sectionNodeId untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ makeThickSolidBySimple: () => Result.ok(createMockShape() as any) });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sectionNodeId).toBe(baseNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the sectionNodeId", () => {
            setupShapeFactoryMock({ makeThickSolidBySimple: () => Result.ok(createMockShape() as any) });
            const node = makeNode(5);

            expect(node.primaryInputId).toBe(baseNode.id);
        });
    });

    describe("setters", () => {
        test("setting thickness should update value and regenerate the shape", () => {
            const makeThickSolidBySimple = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ makeThickSolidBySimple });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(1);

            node.thickness = 12;

            expect(node.thickness).toBe(12);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on thickness change", () => {
            setupShapeFactoryMock({ makeThickSolidBySimple: () => Result.ok(createMockShape() as any) });
            const node = makeNode(5);
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.thickness = 3;
            expect(handler.mock.calls.map((c) => c[0])).toContain("thickness");
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
            setupShapeFactoryMock({ makeThickSolidBySimple: () => Result.ok(createMockShape() as any) });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                makeThickSolidBySimple: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.face })));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ makeThickSolidBySimple: () => Result.ok(createMockShape() as any) });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                makeThickSolidBySimple: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.face })));

            expect(calls).toBe(0);
        });

        test("should call shapeFactory.makeThickSolidBySimple with the resolved section and thickness", () => {
            const makeThickSolidBySimple = rs.fn((_shape: IShape, _thickness: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ makeThickSolidBySimple });
            const result = makeNode(9).generateShape();
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(1);
            expect(makeThickSolidBySimple.mock.calls[0][0]).toBe(section);
            expect(makeThickSolidBySimple.mock.calls[0][1]).toBe(9);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.makeThickSolidBySimple fails", () => {
            setupShapeFactoryMock({
                makeThickSolidBySimple: () => Result.err("thick solid failed"),
            });
            const result = makeNode(5).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape section (e.g. one face out of a multi-face pick)", () => {
        test("should resolve the sub-shape at sectionIndex via findSubShapes and use it as the section", () => {
            const targetFace: any = { shapeType: ShapeTypes.face };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            baseNode.shape = Result.ok(solidShape);

            const makeThickSolidBySimple = rs.fn((_shape: IShape, _thickness: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ makeThickSolidBySimple });

            const node = new ThickSolidNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 0,
                thickness: 5,
            });
            const result = node.generateShape();

            expect(makeThickSolidBySimple.mock.calls[0][0]).toBe(targetFace);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            baseNode.shape = Result.ok(solidShape);

            const node = new ThickSolidNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 3,
                thickness: 5,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.thickSolidEdit", () => {
            expect(makeNode(5).editCommandKey).toBe("modify.thickSolidEdit");
        });
    });

    describe("updateSection", () => {
        test("should redirect to a new section and recompute", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newBase);
            const makeThickSolidBySimple = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ makeThickSolidBySimple });
            const node = makeNode(5);
            expect(node.shape.isOk).toBe(true);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(1);

            node.updateSection(newBase.id, undefined, undefined);

            expect(node.sectionNodeId).toBe(newBase.id);
            expect(makeThickSolidBySimple).toHaveBeenCalledTimes(2);
        });
    });
});
