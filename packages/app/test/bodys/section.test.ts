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
import { SectionNode } from "../../src/bodys/section";
import { createMockShape } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by SectionNode.generateShape()
 * on each resolved base shape) returns itself instead of MockShape's default
 * fresh, override-less instance - preserving whatever shapeType/section
 * overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

describe("SectionNode", () => {
    let doc: IDocument;
    let nodes: INode[];
    let shapeShape: any;
    let pathShape: any;
    let shapeNode: EditableShapeNode;
    let pathNode: EditableShapeNode;

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
        shapeShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.face }));
        pathShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.face }));
        shapeNode = new EditableShapeNode({ document: doc, name: "shape", shape: shapeShape });
        pathNode = new EditableShapeNode({ document: doc, name: "path", shape: pathShape });
        nodes.push(shapeNode, pathNode);
    });

    function makeNode() {
        return new SectionNode({
            document: doc,
            shapeNodeId: shapeNode.id,
            shapeShapeType: ShapeTypes.shape,
            shapeIndex: -1,
            pathNodeId: pathNode.id,
            pathShapeType: ShapeTypes.shape,
            pathIndex: -1,
        });
    }

    describe("constructor", () => {
        test("should initialize shape and path references", () => {
            const node = makeNode();
            expect(node.shapeNodeId).toBe(shapeNode.id);
            expect(node.pathNodeId).toBe(pathNode.id);
        });

        test("should set name from display()", () => {
            expect(makeNode().name).toBe("body.section 1");
        });
    });

    describe("display", () => {
        test("should return body.section", () => {
            expect(makeNode().display()).toBe("body.section");
        });
    });

    describe("redirectReference", () => {
        test("should redirect shapeNodeId and recompute when it matches", () => {
            const newShape = new EditableShapeNode({
                document: doc,
                name: "newShape",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newShape);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);
            const sectionSpy = rs.fn((_path: IShape) => createMockShape());
            (newShape.shape.value as any).section = sectionSpy;

            const changed = node.redirectReference(shapeNode.id, newShape.id);

            expect(changed).toBe(true);
            expect(node.shapeNodeId).toBe(newShape.id);
            expect(sectionSpy).toHaveBeenCalledTimes(1);
        });

        test("should redirect pathNodeId and recompute when it matches", () => {
            const newPath = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newPath);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(pathNode.id, newPath.id);

            expect(changed).toBe(true);
            expect(node.pathNodeId).toBe(newPath.id);
        });

        test("should return false and leave references untouched when the id doesn't match", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.shapeNodeId).toBe(shapeNode.id);
            expect(node.pathNodeId).toBe(pathNode.id);
        });
    });

    describe("primaryInputId", () => {
        test("should be the shapeNodeId", () => {
            const node = makeNode();
            expect(node.primaryInputId).toBe(shapeNode.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when the shape node no longer exists", () => {
            nodes = [pathNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(shapeNode.id);
        });

        test("should return an error when the path node no longer exists", () => {
            nodes = [shapeNode];
            const result = makeNode().generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(pathNode.id);
        });

        test("should call shape.section(path) with the resolved shape and path", () => {
            const sectionResult = createMockShape();
            const sectionSpy = rs.fn((_path: IShape) => sectionResult);
            shapeShape.section = sectionSpy;

            const result = makeNode().generateShape();

            expect(sectionSpy).toHaveBeenCalledTimes(1);
            expect(sectionSpy.mock.calls[0][0]).toBe(pathShape);
            expect(result.isOk).toBe(true);
            expect(result.value).toBe(sectionResult);
        });

        test("should recompute when the shape node's shape changes", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            const newShape = selfTransforming(createMockShape({ shapeType: ShapeTypes.face }));
            newShape.section = () => {
                calls++;
                return createMockShape();
            };
            shapeNode.shape = Result.ok(newShape);

            expect(calls).toBe(1);
        });

        test("should recompute when the path node's shape changes", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            shapeShape.section = () => {
                calls++;
                return createMockShape();
            };
            pathNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.face })));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            shapeShape.section = () => {
                calls++;
                return createMockShape();
            };
            pathNode.shape = Result.ok(selfTransforming(createMockShape({ shapeType: ShapeTypes.face })));

            expect(calls).toBe(0);
        });
    });

    describe("sub-shape references (e.g. one face of a multi-face pick)", () => {
        test("should resolve the sub-shape at shapeIndex via findSubShapes and use it in the section", () => {
            const targetFace: any = { shapeType: ShapeTypes.face, section: () => createMockShape() };
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = (type: number) => (type === ShapeTypes.face ? [targetFace] : []);
            shapeNode.shape = Result.ok(solidShape);
            const sectionSpy = rs.fn((_path: IShape) => createMockShape());
            targetFace.section = sectionSpy;

            const node = new SectionNode({
                document: doc,
                shapeNodeId: shapeNode.id,
                shapeShapeType: ShapeTypes.face,
                shapeIndex: 0,
                pathNodeId: pathNode.id,
                pathShapeType: ShapeTypes.shape,
                pathIndex: -1,
            });
            const result = node.generateShape();

            expect(sectionSpy.mock.calls[0][0]).toBe(pathShape);
            expect(result.isOk).toBe(true);
        });

        test("should return an error when the sub-shape index no longer exists", () => {
            const solidShape: any = selfTransforming(createMockShape({ shapeType: ShapeTypes.solid }));
            solidShape.findSubShapes = () => [];
            shapeNode.shape = Result.ok(solidShape);

            const node = new SectionNode({
                document: doc,
                shapeNodeId: shapeNode.id,
                shapeShapeType: ShapeTypes.face,
                shapeIndex: 3,
                pathNodeId: pathNode.id,
                pathShapeType: ShapeTypes.shape,
                pathIndex: -1,
            });
            const result = node.generateShape();

            expect(result.isOk).toBe(false);
            expect(result.error).toContain("3");
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.sectionEdit", () => {
            expect(makeNode().editCommandKey).toBe("modify.sectionEdit");
        });
    });

    describe("updateReferences", () => {
        test("should redirect to new shape and path references, and recompute", () => {
            const newShape = new EditableShapeNode({
                document: doc,
                name: "newShape",
                shape: selfTransforming(
                    createMockShape({ shapeType: ShapeTypes.face, section: () => createMockShape() }),
                ),
            });
            const newPath = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: selfTransforming(createMockShape({ shapeType: ShapeTypes.face })),
            });
            nodes.push(newShape, newPath);
            const node = makeNode();
            expect(node.shape.isOk).toBe(true);

            node.updateReferences(
                { nodeId: newShape.id, shapeType: ShapeTypes.shape, index: -1 },
                { nodeId: newPath.id, shapeType: ShapeTypes.shape, index: -1 },
            );

            expect(node.shapeNodeId).toBe(newShape.id);
            expect(node.pathNodeId).toBe(newPath.id);
            expect(node.shape.isOk).toBe(true);
        });
    });
});
