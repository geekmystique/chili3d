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
import { SolidNode } from "../../src/bodys/solid";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

/**
 * Patch a mock shape so transformedMul (called by SolidNode.generateShape()
 * on each resolved source shape) returns itself instead of a fresh,
 * override-less instance - preserving whatever overrides the test set up.
 */
function selfTransforming<T extends IShape>(shape: T): T {
    (shape as unknown as { transformedMul: () => T }).transformedMul = () => shape;
    return shape;
}

function mockShell() {
    return createMockShape({ shapeType: ShapeTypes.shell });
}

/** repairShape (called after shapeFactory.solid) reads isNull/shellSewing/fixShape/fixSmallFace. */
function repairableShape() {
    const shape = createMockShape();
    return Object.assign(shape, {
        isNull: () => true,
        shellSewing: () => shape,
        fixShape: () => shape,
        fixSmallFace: () => shape,
    });
}

describe("SolidNode", () => {
    let doc: IDocument;
    let nodes: INode[];

    beforeEach(() => {
        nodes = [];
        doc = createMockDocument({
            modelManager: { findNode: (predicate: (n: INode) => boolean) => nodes.find(predicate) } as any,
        });
    });

    function sourceNode(shape: IShape) {
        const node = new EditableShapeNode({ document: doc, name: "src", shape: selfTransforming(shape) });
        nodes.push(node);
        return node;
    }

    function makeNode(...shapes: IShape[]) {
        return new SolidNode({ document: doc, sourceNodeIds: shapes.map((s) => sourceNode(s).id) });
    }

    describe("constructor", () => {
        test("should initialize sourceNodeIds", () => {
            const shellA = sourceNode(mockShell());
            const shellB = sourceNode(mockShell());
            const node = new SolidNode({ document: doc, sourceNodeIds: [shellA.id, shellB.id] });
            expect(node.sourceNodeIds).toEqual([shellA.id, shellB.id]);
        });

        test("should set name from display()", () => {
            expect(makeNode(mockShell()).name).toBe("body.solid 1");
        });
    });

    describe("display", () => {
        test("should return body.solid", () => {
            expect(makeNode(mockShell()).display()).toBe("body.solid");
        });
    });

    describe("redirectReference", () => {
        test("should redirect a matching source id and recompute", () => {
            setupShapeFactoryMock({ solid: () => Result.ok(repairableShape()) });
            const shellA = sourceNode(mockShell());
            const shellB = sourceNode(mockShell());
            const newSource = sourceNode(mockShell());
            const node = new SolidNode({ document: doc, sourceNodeIds: [shellA.id, shellB.id] });
            expect(node.shape.isOk).toBe(true);

            const changed = node.redirectReference(shellB.id, newSource.id);

            expect(changed).toBe(true);
            expect(node.sourceNodeIds).toEqual([shellA.id, newSource.id]);
        });

        test("should return false and leave sourceNodeIds untouched when the id doesn't match", () => {
            setupShapeFactoryMock({ solid: () => Result.ok(repairableShape()) });
            const node = makeNode(mockShell());
            const before = node.sourceNodeIds;

            const changed = node.redirectReference("unrelated-id", "new-id");

            expect(changed).toBe(false);
            expect(node.sourceNodeIds).toEqual(before);
        });
    });

    describe("primaryInputId", () => {
        test("should be the first source node id", () => {
            const shellA = sourceNode(mockShell());
            const shellB = sourceNode(mockShell());
            const node = new SolidNode({ document: doc, sourceNodeIds: [shellA.id, shellB.id] });

            expect(node.primaryInputId).toBe(shellA.id);
        });
    });

    describe("generateShape", () => {
        test("should return an error when a source node no longer exists", () => {
            const node = new SolidNode({ document: doc, sourceNodeIds: ["missing-id"] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("missing-id");
        });

        test("should call shapeFactory.solid with the resolved shells, then repair the result", () => {
            const shellA = mockShell();
            const shellB = mockShell();
            const repaired = repairableShape();
            const solid = rs.fn(() => Result.ok(repaired));
            setupShapeFactoryMock({ solid });
            const result = makeNode(shellA, shellB).generateShape();
            expect(solid).toHaveBeenCalledWith([shellA, shellB]);
            expect(result.isOk).toBe(true);
        });

        test("should recompute when a source node's shape changes", () => {
            setupShapeFactoryMock({ solid: () => Result.ok(repairableShape()) });
            const source = sourceNode(mockShell());
            const node = new SolidNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            let calls = 0;
            setupShapeFactoryMock({
                solid: () => {
                    calls++;
                    return Result.ok(repairableShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockShell()));

            expect(calls).toBe(1);
        });

        test("should not recompute after being disposed", () => {
            setupShapeFactoryMock({ solid: () => Result.ok(repairableShape()) });
            const source = sourceNode(mockShell());
            const node = new SolidNode({ document: doc, sourceNodeIds: [source.id] });
            expect(node.shape.isOk).toBe(true);

            node.dispose();
            let calls = 0;
            setupShapeFactoryMock({
                solid: () => {
                    calls++;
                    return Result.ok(repairableShape());
                },
            });
            source.shape = Result.ok(selfTransforming(mockShell()));

            expect(calls).toBe(0);
        });

        test("should return Result.err when shapeFactory.solid fails", () => {
            setupShapeFactoryMock({ solid: () => Result.err("solid creation failed") });
            const result = makeNode(mockShell()).generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("editCommandKey", () => {
        test("should be modify.solidEdit", () => {
            expect(makeNode(mockShell()).editCommandKey).toBe("modify.solidEdit");
        });
    });

    describe("updateSources", () => {
        test("should redirect to a new set of sources and recompute", () => {
            const solid = rs.fn(() => Result.ok(repairableShape()));
            setupShapeFactoryMock({ solid });
            const node = makeNode(mockShell());
            expect(node.shape.isOk).toBe(true);
            expect(solid).toHaveBeenCalledTimes(1);

            const newSource = sourceNode(mockShell());
            node.updateSources([newSource.id]);

            expect(node.sourceNodeIds).toEqual([newSource.id]);
            expect(solid).toHaveBeenCalledTimes(2);
        });
    });
});
