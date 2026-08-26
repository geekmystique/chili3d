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
import { createMockDocument, createMockEdgeCurve } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ExtrudeNode } from "../../src/bodys/extrude";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by ExtrudeNode.generateShape()
 * on the resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType/surface/
 * findSubShapes/etc overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("ExtrudeNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let section: any;
    let baseNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        section = selfTransforming(createMockWire());
        baseNode = new EditableShapeNode({ document: doc, name: "section", shape: section });
        nodes.push(baseNode);
    });

    function makeNode(length = 10) {
        return new ExtrudeNode({ document: doc, sectionNodeId: baseNode.id, length });
    }

    describe("constructor", () => {
        test("should initialize sectionNodeId and length", () => {
            const node = makeNode(50);
            expect(node.sectionNodeId).toBe(baseNode.id);
            expect(node.length).toBe(50);
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
        });

        test("should set name from display()", () => {
            expect(makeNode(10).name).toBe("body.extrude");
        });
    });

    describe("display", () => {
        test("should return body.extrude", () => {
            expect(makeNode(10).display()).toBe("body.extrude");
        });
    });

    describe("redirectReference", () => {
        test("should redirect sectionNodeId and recompute when it matches", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newBase);
            const prism = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);
            expect(prism).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.sectionNodeId).toBe(newBase.id);
            expect(prism).toHaveBeenCalledTimes(2);
        });

        test("should return false and leave sectionNodeId untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sectionNodeId).toBe(baseNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the sectionNodeId", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = makeNode(10);

            expect(node.primaryInputId).toBe(baseNode.id);
        });
    });

    describe("setters", () => {
        test("setting length should update value and regenerate the shape", () => {
            const prism = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);
            expect(prism).toHaveBeenCalledTimes(1);

            node.length = 99;

            expect(node.length).toBe(99);
            expect(prism).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on length change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = makeNode(10);
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.length = 77;
            expect(handler.mock.calls.map((c) => c[0])).toContain("length");
        });
    });

    describe("generateShape", () => {
        test("should return an error when the base node no longer exists", () => {
            nodes = [];
            const result = makeNode(10).generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should recompute when the base node's shape changes", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                prism: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                prism: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(0);
        });

        test("should call shapeFactory.prism for non-face wire section", () => {
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const result = makeNode(10).generateShape();
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0].length).toBe(2);
            expect(prism.mock.calls[0][0]).toBe(section);
            expect(result.isOk).toBe(true);
        });

        test("should convert closed wire to face and prism the face to produce a solid", () => {
            const closedWire = selfTransforming(Object.assign(createMockWire(), { isClosed: () => true }));
            baseNode.shape = Result.ok(closedWire);
            const faceShape = createMockShape();
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ face, prism });
            const result = makeNode(10).generateShape();
            expect(face).toHaveBeenCalledWith([closedWire]);
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when face creation fails for closed wire", () => {
            const closedWire = selfTransforming(Object.assign(createMockWire(), { isClosed: () => true }));
            baseNode.shape = Result.ok(closedWire);
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ face: () => Result.err("face creation failed"), prism });
            const result = makeNode(10).generateShape();
            expect(result.isOk).toBe(false);
            expect(prism).not.toHaveBeenCalled();
        });

        test("should convert closed edge (circle) to wire then face before prism", () => {
            const circle = selfTransforming(createMockEdge({ curve: createMockEdgeCurve() }));
            baseNode.shape = Result.ok(circle);
            const wireShape = createMockWire();
            const faceShape = createMockShape();
            const wire = rs.fn((_edges: any[]) => Result.ok(wireShape as any));
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ wire, face, prism });
            const result = makeNode(10).generateShape();
            expect(wire).toHaveBeenCalledWith([circle]);
            expect(face).toHaveBeenCalledWith([wireShape]);
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when wire creation fails for closed edge", () => {
            const circle = selfTransforming(createMockEdge({ curve: createMockEdgeCurve() }));
            baseNode.shape = Result.ok(circle);
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ wire: () => Result.err("wire creation failed"), prism });
            const result = makeNode(10).generateShape();
            expect(result.isOk).toBe(false);
            expect(prism).not.toHaveBeenCalled();
        });

        test("should prism open edge directly without creating a face", () => {
            const openEdge = selfTransforming(
                createMockEdge({ isClosed: () => false, curve: createMockEdgeCurve() }),
            );
            baseNode.shape = Result.ok(openEdge);
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const result = makeNode(10).generateShape();
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(openEdge);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.prism fails", () => {
            setupShapeFactoryMock({
                prism: () => Result.err("prism creation failed"),
            });
            const result = makeNode(10).generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should call shapeFactory.prism for face with planar surface", () => {
            const faceSectionWithPlanarSurface: any = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => true }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            faceSectionWithPlanarSurface.transformedMul = () => faceSectionWithPlanarSurface;
            baseNode.shape = Result.ok(faceSectionWithPlanarSurface);
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            makeNode(20).generateShape();
            expect(prism.mock.calls[0][0]).toBe(faceSectionWithPlanarSurface);
        });

        test("should call shapeFactory.makeThickSolidBySimple for non-planar face", () => {
            const faceSectionNonPlanar: any = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => false }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            faceSectionNonPlanar.transformedMul = () => faceSectionNonPlanar;
            baseNode.shape = Result.ok(faceSectionNonPlanar);
            const makeThickSolidBySimple = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({
                makeThickSolidBySimple,
                prism: () => Result.err("should not call prism"),
            });
            const result = makeNode(20).generateShape();
            expect(makeThickSolidBySimple).toHaveBeenCalledWith(faceSectionNonPlanar, 20);
            expect(result.isOk).toBe(true);
        });

        test("should return error when makeThickSolidBySimple fails for non-planar face", () => {
            const faceSectionNonPlanar: any = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => false }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            faceSectionNonPlanar.transformedMul = () => faceSectionNonPlanar;
            baseNode.shape = Result.ok(faceSectionNonPlanar);
            setupShapeFactoryMock({
                makeThickSolidBySimple: () => Result.err("thick solid failed"),
            });
            const result = makeNode(20).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape section (e.g. a face of an existing solid)", () => {
        test("should resolve the sub-shape at sectionIndex via findSubShapes and use it as the section", () => {
            const targetFace: any = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => true }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            baseNode.shape = Result.ok(solidShape);

            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });

            const node = new ExtrudeNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 0,
                length: 15,
            });
            const result = node.generateShape();

            expect(prism.mock.calls[0][0]).toBe(targetFace);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            baseNode.shape = Result.ok(solidShape);

            const node = new ExtrudeNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 3,
                length: 15,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.extrudeEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.extrudeEdit");
        });
    });

    describe("updateSection", () => {
        test("should redirect to a new section and recompute", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newBase);
            const prism = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = makeNode(10);
            expect(node.shape.isOk).toBe(true);
            expect(prism).toHaveBeenCalledTimes(1);

            node.updateSection(newBase.id, undefined, undefined);

            expect(node.sectionNodeId).toBe(newBase.id);
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
            expect(prism).toHaveBeenCalledTimes(2);
        });
    });
});
