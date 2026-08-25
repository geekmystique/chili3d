// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type IShape,
    Matrix4,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { RevolvedNode } from "../../../src/bodys/revolve";
import { Revolve } from "../../../src/commands/create/revolve";
import {
    ensureGlobalStubApp,
    mockShape,
    seedStepDatas,
    shapeData,
    shapeStepResult,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function liveSectionNode(doc: IDocument, shapeType: ShapeType) {
    const shape = mockShape({ shapeType });
    return new EditableShapeNode({
        document: doc,
        name: "section",
        shape: shape as unknown as IShape,
        materialId: "mat-1",
    });
}

function axisStepData(overrides: { transform?: Matrix4; node?: unknown } = {}) {
    const axisEdge = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: {
                direction: XYZ.unitZ,
                value: () => XYZ.zero,
            },
        },
    };
    return {
        type: "shape" as const,
        shapes: [
            shapeData({
                shape: axisEdge,
                point: XYZ.zero,
                transform: overrides.transform ?? Matrix4.identity(),
                node: overrides.node,
            }),
        ],
    } as any;
}

describe("Revolve", () => {
    test("should have command metadata", () => {
        const data = (Revolve as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.revol");
        expect(data.icon).toBe("icon-revolve");
    });

    test("angle should default to 360", () => {
        const cmd = new Revolve();
        expect(cmd.angle).toBe(360);
    });

    test("angle setter should update property", () => {
        const cmd = new Revolve();
        cmd.angle = 180;
        expect(cmd.angle).toBe(180);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Revolve();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        test("should build a RevolvedNode referencing the picked section node, with a line axis", () => {
            const cmd = new Revolve();
            wireCommand(cmd);
            const sectionShape = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
            };
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: sectionShape, node: { id: "sect-1" }, point: XYZ.zero }]),
                axisStepData(),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(RevolvedNode);
            expect(node.angle).toBe(360);
            expect(node.sectionNodeId).toBe("sect-1");
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
            // axis anchored at the origin, pointing along +Z
            expect(node.axis.point.isEqualTo(XYZ.zero)).toBe(true);
            expect(node.axis.direction.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should honor a custom angle set on the command", () => {
            const cmd = new Revolve();
            cmd.angle = 90;
            wireCommand(cmd);
            const sectionShape = { shapeType: ShapeTypes.face, normal: () => [XYZ.zero, XYZ.unitZ] };
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: sectionShape, node: { id: "sect-1" }, point: XYZ.zero }]),
                axisStepData(),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.angle).toBe(90);
        });

        test("should reference the sub-shape's type and index when the section is a face of an existing solid", () => {
            const cmd = new Revolve();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                            index: 2,
                        } as any,
                        node: { id: "solid-1" },
                        point: XYZ.zero,
                    },
                ]),
                axisStepData(),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.sectionNodeId).toBe("solid-1");
            expect(node.sectionShapeType).toBe(ShapeTypes.face);
            expect(node.sectionIndex).toBe(2);
        });
    });

    describe("afterNodeCreated", () => {
        test("should hide, not delete, the whole-shape section and axis source nodes when deleteObjects is true", () => {
            const cmd = new Revolve();
            const { doc } = wireCommand(cmd);
            const parent = doc.modelManager.rootNode as unknown as TrackingParent;
            const sectionNode = liveSectionNode(doc, ShapeTypes.wire);
            sectionNode.parent = parent;
            const axisNode = liveSectionNode(doc, ShapeTypes.edge);
            axisNode.parent = parent;
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: sectionNode }]),
                axisStepData({ node: axisNode }),
            ]);

            (cmd as any).afterNodeCreated();

            expect(sectionNode.visible).toBe(false);
            expect(axisNode.visible).toBe(false);
            expect(parent.removed).toHaveLength(0);
        });

        test("should leave the source nodes untouched when deleteObjects is false", () => {
            const cmd = new Revolve();
            cmd.deleteObjects = false;
            const { doc } = wireCommand(cmd);
            const sectionNode = liveSectionNode(doc, ShapeTypes.wire);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: sectionNode }]),
                axisStepData(),
            ]);

            (cmd as any).afterNodeCreated();

            expect(sectionNode.visible).toBe(true);
        });

        test("should splice a downstream feature onto the new Revolve when the section already has one", () => {
            const originalFactory = (globalThis as any).app.shapeProvider.factory;
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: new Proxy({}, { get: () => () => Result.ok(mockShape()) }),
            });

            try {
                const cmd = new Revolve();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const sectionNode = liveSectionNode(doc, ShapeTypes.wire);
                sectionNode.parent = parent;
                // RevolvedNode.generateShape needs isClosed() on a wire section.
                Object.assign(sectionNode.shape.value, { isClosed: () => false });

                const downstream = new RevolvedNode({
                    document: doc,
                    sectionNodeId: sectionNode.id,
                    axis: { point: XYZ.zero, direction: XYZ.unitZ } as any,
                    angle: 360,
                });
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [sectionNode, downstream].find(predicate);
                expect(downstream.shape.isOk).toBe(true); // establishes the sectionNode -> downstream DAG edge

                seedStepDatas(cmd, [
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node: sectionNode }]),
                    axisStepData(),
                ]);

                const newRevolve = (cmd as any).geometryNode();
                parent.add(newRevolve);
                (cmd as any).afterNodeCreated();

                expect(downstream.sectionNodeId).toBe(newRevolve.id);
                // newRevolve is no longer the end of the chain - downstream is - so it hides itself.
                expect(newRevolve.visible).toBe(false);
            } finally {
                Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                    configurable: true,
                    value: originalFactory,
                });
            }
        });
    });

    describe("repositionAfterSection", () => {
        test("should move the new Revolve to sit right after its section node in the tree", () => {
            const cmd = new Revolve();
            const { doc } = wireCommand(cmd);
            const sectionParent = doc.modelManager.rootNode as unknown as TrackingParent;
            const sectionNode = liveSectionNode(doc, ShapeTypes.face);
            sectionNode.parent = sectionParent;
            (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                [sectionNode].find(predicate);

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: sectionNode }]),
                axisStepData(),
            ]);

            const newRevolve = (cmd as any).geometryNode();
            const revolveParent = doc.modelManager.rootNode as unknown as TrackingParent;
            newRevolve.parent = revolveParent;

            const moveSpy = rs.spyOn(revolveParent, "move");
            (cmd as any).afterNodeCreated();

            expect(moveSpy).toHaveBeenCalledWith(newRevolve, sectionParent, sectionNode);
        });

        test("should do nothing when the section node cannot be found", () => {
            const cmd = new Revolve();
            const { doc } = wireCommand(cmd);
            (doc.modelManager as any).findNode = () => undefined;

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: { id: "missing" } }]),
                axisStepData(),
            ]);

            const newRevolve = (cmd as any).geometryNode();
            newRevolve.parent = doc.modelManager.rootNode;

            expect(() => (cmd as any).afterNodeCreated()).not.toThrow();
        });
    });

    describe("LineFilter", () => {
        function getFilter() {
            const cmd = new Revolve();
            const steps = (cmd as any).getSteps();
            // The second step carries the LineFilter via options.shapeFilter.
            return steps[1].options.shapeFilter;
        }

        test("should allow an edge whose basis curve is a line", () => {
            const filter = getFilter();
            const lineEdge = {
                shapeType: ShapeTypes.edge,
                curve: { basisCurve: { direction: XYZ.unitZ } },
            };
            expect(filter.allow(lineEdge)).toBe(true);
        });

        test("should reject an edge whose basis curve is not a line", () => {
            const filter = getFilter();
            const circleEdge = {
                shapeType: ShapeTypes.edge,
                curve: { basisCurve: { center: XYZ.zero, radius: 1 } },
            };
            expect(filter.allow(circleEdge)).toBe(false);
        });

        test("should reject non-edge shapes", () => {
            const filter = getFilter();
            expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
            expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
        });
    });

    describe("getSteps callbacks", () => {
        test("the axis step should carry beforeSelection/afterSelection that update highlight state", () => {
            const cmd = new Revolve();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, point: XYZ.zero }]),
            ]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
