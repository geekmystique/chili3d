// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type INode,
    type IShape,
    Line,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, createMockEdgeCurve } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { RevolvedNode } from "../../src/bodys/revolve";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by RevolvedNode.generateShape()
 * on the resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType/isClosed/etc
 * overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("RevolvedNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let section: any;
    let baseNode: EditableShapeNode;
    let axis: Line;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        section = selfTransforming(createMockWire());
        baseNode = new EditableShapeNode({ document: doc, name: "section", shape: section });
        nodes.push(baseNode);
        axis = new Line({ point: XYZ.zero, direction: XYZ.unitX });
    });

    function makeNode(angle = 360) {
        return new RevolvedNode({ document: doc, sectionNodeId: baseNode.id, axis, angle });
    }

    describe("constructor", () => {
        test("should initialize sectionNodeId, axis, and angle", () => {
            const node = makeNode(270);
            expect(node.sectionNodeId).toBe(baseNode.id);
            expect(node.axis).toBe(axis);
            expect(node.angle).toBe(270);
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
        });

        test("should set name from display()", () => {
            expect(makeNode(90).name).toBe("body.revol 1");
        });
    });

    describe("display", () => {
        test("should return body.revol", () => {
            expect(makeNode(180).display()).toBe("body.revol");
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
            const revolve = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ revolve });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);
            expect(revolve).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(baseNode.id, newBase.id);

            expect(changed).toBe(true);
            expect(node.sectionNodeId).toBe(newBase.id);
            expect(revolve).toHaveBeenCalledTimes(2);
        });

        test("should return false and leave sectionNodeId untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ revolve: () => Result.ok(createMockShape() as any) });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sectionNodeId).toBe(baseNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the sectionNodeId", () => {
            setupShapeFactoryMock({ revolve: () => Result.ok(createMockShape() as any) });
            const node = makeNode(360);

            expect(node.primaryInputId).toBe(baseNode.id);
        });
    });

    describe("setters", () => {
        test("setting angle should update value and regenerate the shape", () => {
            const revolve = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ revolve });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);
            expect(revolve).toHaveBeenCalledTimes(1);

            node.angle = 90;

            expect(node.angle).toBe(90);
            expect(revolve).toHaveBeenCalledTimes(2);
        });

        test("setting axis should update value and regenerate the shape", () => {
            const revolve = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ revolve });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);
            expect(revolve).toHaveBeenCalledTimes(1);

            const newAxis = new Line({ point: XYZ.unitY, direction: XYZ.unitZ });
            node.axis = newAxis;

            expect(node.axis).toBe(newAxis);
            expect(revolve).toHaveBeenCalledTimes(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on angle change", () => {
            setupShapeFactoryMock({ revolve: () => Result.ok(createMockShape() as any) });
            const node = makeNode(360);
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.angle = 45;
            expect(handler.mock.calls.map((c) => c[0])).toContain("angle");
        });
    });

    describe("generateShape", () => {
        test("should return an error when the base node no longer exists", () => {
            nodes = [];
            const result = makeNode(360).generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(baseNode.id);
        });

        test("should recompute when the base node's shape changes", () => {
            setupShapeFactoryMock({ revolve: () => Result.ok(createMockShape() as any) });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                revolve: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ revolve: () => Result.ok(createMockShape() as any) });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                revolve: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            baseNode.shape = Result.ok(selfTransforming(createMockWire()));

            expect(calls).toBe(0);
        });

        test("should call shapeFactory.revolve for a non-closed wire section", () => {
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ revolve });
            const result = makeNode(360).generateShape();
            expect(revolve).toHaveBeenCalledTimes(1);
            expect(revolve.mock.calls[0][0]).toBe(section);
            expect(revolve.mock.calls[0][1]).toBe(axis);
            expect(revolve.mock.calls[0][2]).toBe(360);
            expect(result.isOk).toBe(true);
        });

        test("should convert closed wire to face and revolve the face to produce a solid", () => {
            const closedWire = selfTransforming(Object.assign(createMockWire(), { isClosed: () => true }));
            baseNode.shape = Result.ok(closedWire);
            const faceShape = createMockShape();
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ face, revolve });
            const result = makeNode(180).generateShape();
            expect(face).toHaveBeenCalledWith([closedWire]);
            expect(revolve).toHaveBeenCalledTimes(1);
            expect(revolve.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when face creation fails for closed wire", () => {
            const closedWire = selfTransforming(Object.assign(createMockWire(), { isClosed: () => true }));
            baseNode.shape = Result.ok(closedWire);
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ face: () => Result.err("face creation failed"), revolve });
            const result = makeNode(180).generateShape();
            expect(result.isOk).toBe(false);
            expect(revolve).not.toHaveBeenCalled();
        });

        test("should convert closed edge (circle) to wire then face before revolve", () => {
            const circle = selfTransforming(createMockEdge({ curve: createMockEdgeCurve() }));
            baseNode.shape = Result.ok(circle);
            const wireShape = createMockWire();
            const faceShape = createMockShape();
            const wire = rs.fn((_edges: any[]) => Result.ok(wireShape as any));
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ wire, face, revolve });
            const result = makeNode(180).generateShape();
            expect(wire).toHaveBeenCalledWith([circle]);
            expect(face).toHaveBeenCalledWith([wireShape]);
            expect(revolve).toHaveBeenCalledTimes(1);
            expect(revolve.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.revolve fails", () => {
            setupShapeFactoryMock({
                revolve: () => Result.err("revolve creation failed"),
            });
            const result = makeNode(180).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape section (e.g. a face of an existing solid)", () => {
        test("should resolve the sub-shape at sectionIndex via findSubShapes and use it as the section", () => {
            const targetFace: any = { shapeType: ShapeTypes.face };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            baseNode.shape = Result.ok(solidShape);

            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ revolve });

            const node = new RevolvedNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 0,
                axis,
                angle: 360,
            });
            const result = node.generateShape();

            expect(revolve.mock.calls[0][0]).toBe(targetFace);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            baseNode.shape = Result.ok(solidShape);

            const node = new RevolvedNode({
                document: doc,
                sectionNodeId: baseNode.id,
                sectionShapeType: ShapeTypes.face,
                sectionIndex: 3,
                axis,
                angle: 360,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.revolveEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.revolveEdit");
        });
    });

    describe("updateSection", () => {
        test("should redirect to a new section and axis, and recompute", () => {
            const newBase = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: selfTransforming(createMockWire()),
            });
            nodes.push(newBase);
            const revolve = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ revolve });
            const node = makeNode(360);
            expect(node.shape.isOk).toBe(true);
            expect(revolve).toHaveBeenCalledTimes(1);

            const newAxis = new Line({ point: XYZ.unitY, direction: XYZ.unitZ });
            node.updateSection(newBase.id, undefined, undefined, newAxis);

            expect(node.sectionNodeId).toBe(newBase.id);
            expect(node.axis).toBe(newAxis);
            expect(revolve).toHaveBeenCalledTimes(2);
        });
    });
});
