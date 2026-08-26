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
import { CurveProjectionNode } from "../../src/bodys/curveProjection";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by CurveProjectionNode.generateShape()
 * on each resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType overrides the
 * test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("CurveProjectionNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let curveShape: any;
    let faceShape: any;
    let curveNode: EditableShapeNode;
    let faceNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        curveShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.edge }));
        faceShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.face }));
        curveNode = new EditableShapeNode({ document: doc, name: "curve", shape: curveShape });
        faceNode = new EditableShapeNode({ document: doc, name: "face", shape: faceShape });
        nodes.push(curveNode, faceNode);
    });

    function makeNode(dir = "0,0,-1") {
        return new CurveProjectionNode({
            document: doc,
            shapeNodeId: curveNode.id,
            shapeShapeType: ShapeTypes.shape,
            shapeIndex: -1,
            faceNodeId: faceNode.id,
            faceShapeType: ShapeTypes.shape,
            faceIndex: -1,
            dir,
        });
    }

    describe("constructor", () => {
        test("should initialize shape, face references, and dir", () => {
            const node = makeNode("1,0,0");
            expect(node.shapeNodeId).toBe(curveNode.id);
            expect(node.faceNodeId).toBe(faceNode.id);
            expect(node.dir).toBe("1,0,0");
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.curveProjection");
        });
    });

    describe("display", () => {
        test("should return body.curveProjection", () => {
            expect(makeNode().display()).toBe("body.curveProjection");
        });
    });

    describe("redirectReference", () => {
        test("should redirect shapeNodeId and recompute when it matches", () => {
            const newCurve = new EditableShapeNode({
                document: doc,
                name: "newCurve",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })),
            });
            nodes.push(newCurve);
            const curveProjection = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ curveProjection });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            expect(curveProjection).toHaveBeenCalledTimes(1);

            const changed = node.redirectReference(curveNode.id, newCurve.id);

            expect(changed).toBe(true);
            expect(node.shapeNodeId).toBe(newCurve.id);
            expect(curveProjection).toHaveBeenCalledTimes(2);
        });

        test("should redirect faceNodeId and recompute when it matches", () => {
            const newFace = new EditableShapeNode({
                document: doc,
                name: "newFace",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newFace);
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(faceNode.id, newFace.id);

            expect(changed).toBe(true);
            expect(node.faceNodeId).toBe(newFace.id);
        });

        test("should return false and leave references untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.shapeNodeId).toBe(curveNode.id);
            expect(node.faceNodeId).toBe(faceNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the shapeNodeId", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.primaryInputId).toBe(curveNode.id);
        });
    });

    describe("dir setter", () => {
        test("should update dir and regenerate the shape when given three valid numbers", () => {
            const curveProjection = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ curveProjection });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            expect(curveProjection).toHaveBeenCalledTimes(1);

            node.dir = "0,1,0";

            expect(node.dir).toBe("0,1,0");
            expect(curveProjection).toHaveBeenCalledTimes(2);
        });

        test("should reject a dir string that doesn't parse to exactly three numbers", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode("0,0,-1");
            const originalAlert = globalThis.alert;
            globalThis.alert = () => {};
            try {
                node.dir = "1,2";
                expect(node.dir).toBe("0,0,-1");
            } finally {
                globalThis.alert = originalAlert;
            }
        });
    });

    describe("generateShape", () => {
        test("should return an error when the curve node no longer exists", () => {
            nodes = [faceNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(curveNode.id);
        });

        test("should return an error when the face node no longer exists", () => {
            nodes = [curveNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(faceNode.id);
        });

        test("should call shapeFactory.curveProjection with the resolved curve, face, and normalized dir", () => {
            const curveProjection = rs.fn((_curve: IShape, _face: IShape, _dir: unknown) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ curveProjection });

            const result = makeNode("0,0,-5").generateShape();

            expect(curveProjection).toHaveBeenCalledTimes(1);
            expect(curveProjection.mock.calls[0][0]).toBe(curveShape);
            expect(curveProjection.mock.calls[0][1]).toBe(faceShape);
            const dir = curveProjection.mock.calls[0][2] as { z: number };
            expect(dir.z).toBeCloseTo(-1);
            expect(result.isOk).toBe(true);
        });

        test("should recompute when the curve node's shape changes", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                curveProjection: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            curveNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })));

            expect(calls).toBe(1);
        });

        test("should recompute when the face node's shape changes", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                curveProjection: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            faceNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.face })));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.ok(createMockShape() as any) });
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                curveProjection: () => {
                    calls++;
                    return Result.ok(createMockShape() as any);
                },
            });
            curveNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.edge })));

            expect(calls).toBe(0);
        });

        test("should return Result.err when shapeFactory.curveProjection fails", () => {
            setupShapeFactoryMock({ curveProjection: () => Result.err("projection failed") });
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("sub-shape references (e.g. one face of a multi-face pick)", () => {
        test("should resolve the sub-shape at faceIndex via findSubShapes and use it in the projection", () => {
            const targetFace: any = { shapeType: ShapeTypes.face };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            faceNode.shape = Result.ok(solidShape);

            const curveProjection = rs.fn((_curve: IShape, _face: IShape, _dir: unknown) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ curveProjection });

            const node = new CurveProjectionNode({
                document: doc,
                shapeNodeId: curveNode.id,
                shapeShapeType: ShapeTypes.shape,
                shapeIndex: -1,
                faceNodeId: faceNode.id,
                faceShapeType: ShapeTypes.face,
                faceIndex: 0,
                dir: "0,0,-1",
            });
            const result = node.generateShape();

            expect(curveProjection.mock.calls[0][1]).toBe(targetFace);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            faceNode.shape = Result.ok(solidShape);

            const node = new CurveProjectionNode({
                document: doc,
                shapeNodeId: curveNode.id,
                shapeShapeType: ShapeTypes.shape,
                shapeIndex: -1,
                faceNodeId: faceNode.id,
                faceShapeType: ShapeTypes.face,
                faceIndex: 2,
                dir: "0,0,-1",
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("2");
        });
    });
});
