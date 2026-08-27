// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IDocument,
    type IShape,
    Result,
    type ShapeType,
    ShapeTypes,
    SnapEventHandler,
    XYZ,
} from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { ExtrudeNode } from "../../../src/bodys/extrude";
import { ExtrudeCommand } from "../../../src/commands/create/extrude";
import {
    ensureGlobalStubApp,
    mockShape,
    pointStepResult,
    seedStepDatas,
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
        name: "rect",
        shape: shape as unknown as IShape,
        materialId: "mat-1",
    });
}

/**
 * A minimal pick-owner stand-in: sweepRefFromPick (used to derive
 * sectionShapeType/sectionIndex) reads owner.shape to decide whole-shape vs
 * sub-shape, so a bare `{ id }` node isn't enough once a real pick owner is
 * expected.
 */
function mockOwner(id: string, shapeType: ShapeType, findSubShapes: (type: number) => IShape[] = () => []) {
    return { id, shape: Result.ok({ shapeType, findSubShapes } as unknown as IShape) };
}

describe("ExtrudeCommand", () => {
    test("should have command metadata", () => {
        const data = (ExtrudeCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.extrude");
        expect(data.icon).toBe("icon-prism");
    });

    test("getSteps should return two steps", () => {
        const cmd = new ExtrudeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("length property", () => {
        test("should default to 10", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            expect(cmd.length).toBe(10);
        });

        test("setting it to the same value should be a no-op (no active step to finish)", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            expect(() => {
                cmd.length = 10;
            }).not.toThrow();
            expect(cmd.length).toBe(10);
        });

        test("typing a new value should apply it through the active SnapEventHandler", () => {
            const cmd = new ExtrudeCommand();
            const { doc } = wireCommand(cmd);
            const applyTypedInput = rs.fn(() => Result.ok("25"));
            const fakeHandler: any = { applyTypedInput };
            Object.setPrototypeOf(fakeHandler, SnapEventHandler.prototype);
            (doc as any).application = { activeView: {} };
            (doc.visual as any).eventHandler = fakeHandler;

            cmd.length = 25;

            expect(cmd.length).toBe(25);
            expect(applyTypedInput).toHaveBeenCalledWith((doc as any).application.activeView, "25");
        });

        test("typing a new value should do nothing to the view when no SnapEventHandler is active", () => {
            const cmd = new ExtrudeCommand();
            const { doc } = wireCommand(cmd);
            (doc as any).application = { activeView: {} };
            (doc.visual as any).eventHandler = { isEnabled: true } as any;

            expect(() => {
                cmd.length = 25;
            }).not.toThrow();
            expect(cmd.length).toBe(25);
        });
    });

    describe("geometryNode", () => {
        test("should build an ExtrudeNode referencing the picked node, whose length is the signed projection of the picked point", () => {
            // Face on the XY plane: normal() returns [point, +Z].
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                        } as Partial<IShape>,
                        node: mockOwner("rect-1", ShapeTypes.face),
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ExtrudeNode);
            expect(node.length).toBeCloseTo(5, 6);
            expect(node.sectionNodeId).toBe("rect-1");
            expect(node.sectionShapeType).toBeUndefined();
            expect(node.sectionIndex).toBeUndefined();
        });

        test("should produce a negative length when the picked point is below the section plane", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                            isClosed: () => false,
                        } as Partial<IShape>,
                        node: mockOwner("rect-1", ShapeTypes.face),
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: -3 }) }),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.length).toBeCloseTo(-3, 6);
        });

        test("should reference the sub-shape's type and index when the pick is a face of an existing solid", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            // shapeStepResult wraps the picked shape through mockShape(), which
            // copies the given properties onto a fresh object - so isEqual can't
            // rely on reference equality to the original candidate object here,
            // it has to compare a marker property that survives the copy.
            const otherFace = { shapeType: ShapeTypes.face, isEqual: () => false };
            const targetFace = {
                shapeType: ShapeTypes.face,
                isEqual: (o: { marker?: string }) => o.marker === "picked",
            };
            const owner = mockOwner("solid-1", ShapeTypes.solid, (type) =>
                type === ShapeTypes.face
                    ? [
                          otherFace as unknown as IShape,
                          otherFace as unknown as IShape,
                          targetFace as unknown as IShape,
                      ]
                    : [],
            );
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                            marker: "picked",
                        } as any,
                        node: owner,
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
            ]);

            const node = (cmd as any).geometryNode();
            expect(node.sectionNodeId).toBe("solid-1");
            expect(node.sectionShapeType).toBe(ShapeTypes.face);
            expect(node.sectionIndex).toBe(2);
        });
    });

    describe("afterNodeCreated", () => {
        test("should hide, not delete, the whole-shape source node when deleteObjects is true", () => {
            const cmd = new ExtrudeCommand();
            const { doc } = wireCommand(cmd);
            const parent = doc.modelManager.rootNode as unknown as TrackingParent;
            const sectionNode = liveSectionNode(doc, ShapeTypes.wire);
            sectionNode.parent = parent;
            seedStepDatas(cmd, [
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.wire } as Partial<IShape>, node: sectionNode },
                ]),
            ]);

            (cmd as any).afterNodeCreated();

            expect(sectionNode.visible).toBe(false);
            expect(parent.removed).toHaveLength(0);
        });

        test("should leave the source node untouched when deleteObjects is false", () => {
            const cmd = new ExtrudeCommand();
            cmd.deleteObjects = false;
            const { doc } = wireCommand(cmd);
            const sectionNode = liveSectionNode(doc, ShapeTypes.wire);
            seedStepDatas(cmd, [
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.wire } as Partial<IShape>, node: sectionNode },
                ]),
            ]);

            (cmd as any).afterNodeCreated();

            expect(sectionNode.visible).toBe(true);
        });

        test("should splice a downstream feature onto the new Extrude when the source already has one", () => {
            // The shared stub-app factory's fake shape lacks isEqual, which
            // ShapeNode.setShape needs to compare against a shape that's already
            // ok - fine for a single compute, but this test recomputes downstream
            // a second time via redirectReference. Swap in mockShape()-based
            // results (isEqual: () => false, so every setShape goes through) for
            // the duration of this test only.
            const originalFactory = (globalThis as any).app.shapeProvider.factory;
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: new Proxy({}, { get: () => () => Result.ok(mockShape()) }),
            });

            try {
                const cmd = new ExtrudeCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                // Face, not wire: selectedWholeShapeNodes only treats the pick as "the
                // node's whole shape" (and so hides it) when the picked shape's type
                // matches the node's own shape type - both need to agree here.
                const sectionNode = liveSectionNode(doc, ShapeTypes.face);
                sectionNode.parent = parent;
                // ExtrudeNode.generateShape needs surface()/normal() on a face section;
                // the shared mockShape() doesn't implement either.
                Object.assign(sectionNode.shape.value, {
                    surface: () => ({ isPlanar: () => true }),
                    normal: () => [XYZ.zero, XYZ.unitZ],
                });

                // downstream already references sectionNode directly (e.g. a boolean
                // built from the same sketch).
                const downstream = new ExtrudeNode({
                    document: doc,
                    sectionNodeId: sectionNode.id,
                    length: 5,
                });
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [sectionNode, downstream].find(predicate);
                expect(downstream.shape.isOk).toBe(true); // establishes the sectionNode -> downstream DAG edge

                seedStepDatas(cmd, [
                    shapeStepResult([
                        {
                            shape: {
                                shapeType: ShapeTypes.face,
                                normal: () => [XYZ.zero, XYZ.unitZ],
                            } as Partial<IShape>,
                            node: sectionNode,
                            point: XYZ.zero,
                        },
                    ]),
                    pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
                ]);

                const newExtrude = (cmd as any).geometryNode();
                parent.add(newExtrude);
                (cmd as any).afterNodeCreated();

                expect(downstream.sectionNodeId).toBe(newExtrude.id);
                // newExtrude is no longer the end of the chain - downstream is - so it hides itself.
                expect(newExtrude.visible).toBe(false);
            } finally {
                Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                    configurable: true,
                    value: originalFactory,
                });
            }
        });
    });

    describe("repositionAfterSection", () => {
        test("should move the new Extrude to sit right after its section node in the tree", () => {
            const cmd = new ExtrudeCommand();
            const { doc } = wireCommand(cmd);
            const sectionParent = doc.modelManager.rootNode as unknown as TrackingParent;
            const sectionNode = liveSectionNode(doc, ShapeTypes.face);
            sectionNode.parent = sectionParent;
            (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                [sectionNode].find(predicate);

            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                        } as Partial<IShape>,
                        node: sectionNode,
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
            ]);

            const newExtrude = (cmd as any).geometryNode();
            const extrudeParent = doc.modelManager.rootNode as unknown as TrackingParent;
            newExtrude.parent = extrudeParent;

            const moveSpy = rs.spyOn(extrudeParent, "move");
            (cmd as any).afterNodeCreated();

            expect(moveSpy).toHaveBeenCalledWith(newExtrude, sectionParent, sectionNode);
        });

        test("should do nothing when the section node cannot be found", () => {
            const cmd = new ExtrudeCommand();
            const { doc } = wireCommand(cmd);
            (doc.modelManager as any).findNode = () => undefined;

            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.face,
                            normal: () => [XYZ.zero, XYZ.unitZ],
                        } as Partial<IShape>,
                        node: mockOwner("missing", ShapeTypes.face),
                        point: XYZ.zero,
                    },
                ]),
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }) }),
            ]);

            const newExtrude = (cmd as any).geometryNode();
            newExtrude.parent = doc.modelManager.rootNode;

            expect(() => (cmd as any).afterNodeCreated()).not.toThrow();
        });
    });

    describe("getLengthStepData", () => {
        function buildFaceCommand(planar: boolean, surface?: () => unknown) {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            const shapeOverride: any = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
            };
            if (surface) {
                shapeOverride.surface = surface;
            }
            seedStepDatas(cmd, [shapeStepResult([{ shape: shapeOverride, point: XYZ.zero }])]);
            return cmd;
        }

        test("should expose a point and a direction equal to the face normal", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            expect(data.point.isEqualTo(XYZ.zero)).toBe(true);
            expect(data.direction.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(typeof data.preview).toBe("function");
        });

        test("preview should return [] when point is undefined", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            expect(data.preview(undefined)).toEqual([]);
        });

        test("preview should return [] when the distance is below float precision", () => {
            const cmd = buildFaceCommand(true);
            const data = (cmd as any).getLengthStepData();
            // point essentially on the section plane → dist ≈ 0
            expect(data.preview(new XYZ({ x: 1, y: 2, z: 0 }))).toEqual([]);
        });

        test("preview should reflect the live drag distance in the length property, without finishing anything", () => {
            const cmd = buildFaceCommand(true, () => ({ isPlanar: () => true }));
            const data = (cmd as any).getLengthStepData();

            data.preview(new XYZ({ x: 0, y: 0, z: 7 }));

            expect(cmd.length).toBeCloseTo(7, 6);
        });

        test("preview of a planar face should mesh a prism", () => {
            const cmd = buildFaceCommand(true, () => ({ isPlanar: () => true }));
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 4 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });

        test("preview of a non-planar face should mesh a thick solid", () => {
            const cmd = buildFaceCommand(false, () => ({ isPlanar: () => false }));
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 4 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });

        test("preview of an edge section should mesh a prism (no surface branch)", () => {
            const cmd = new ExtrudeCommand();
            wireCommand(cmd);
            // An edge whose curve normal is +Z (vec parallel to X → cross gives Z).
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.edge,
                            curve: {
                                basisCurve: { axis: undefined, dn: () => XYZ.unitX, direction: undefined },
                            },
                            isClosed: () => false,
                        } as Partial<IShape>,
                        point: XYZ.zero,
                    },
                ]),
            ]);
            const data = (cmd as any).getLengthStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 0, z: 2 }));
            expect(Array.isArray(preview)).toBe(true);
            expect(preview).toHaveLength(1);
        });
    });
});
