// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Result, type ShapeType, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CurveProjectionNode } from "../../../src/bodys/curveProjection";
import { CurveProjectionCommand } from "../../../src/commands/create/curveProjection";
import {
    ensureGlobalStubApp,
    seedStepDatas,
    shapeStepResult,
    stubTransactionRun,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/**
 * A minimal pick-owner stand-in: sweepRefFromPick reads owner.shape to
 * decide whole-shape vs sub-shape, so a bare node object without a `.shape`
 * Result crashes it.
 */
function mockOwner(id: string, shapeType: ShapeType) {
    return { id, shape: Result.ok({ shapeType, findSubShapes: () => [] } as unknown as IShape) };
}

describe("CurveProjectionCommand", () => {
    test("should have command metadata", () => {
        const data = (CurveProjectionCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.curveProjection");
        expect(data.icon).toBe("icon-curveProject");
    });

    test("dir should default to 0,0,-1", () => {
        const cmd = new CurveProjectionCommand();
        expect(cmd.dir).toBe("0,0,-1");
    });

    test("dir setter should update property when given three valid numbers", () => {
        const cmd = new CurveProjectionCommand();
        cmd.dir = "1,0,0";
        expect(cmd.dir).toBe("1,0,0");
    });

    test("dir setter should reject a string that doesn't parse to exactly three numbers", () => {
        const cmd = new CurveProjectionCommand();
        const originalAlert = globalThis.alert;
        globalThis.alert = () => {};
        try {
            cmd.dir = "1,2";
            expect(cmd.dir).toBe("0,0,-1");
        } finally {
            globalThis.alert = originalAlert;
        }
    });

    test("getSteps should return two steps", () => {
        const cmd = new CurveProjectionCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("geometryNode", () => {
        test("should build a CurveProjectionNode referencing the picked curve and face nodes", () => {
            const cmd = new CurveProjectionCommand();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.edge }, node: mockOwner("curve-1", ShapeTypes.edge) },
                ]),
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.face }, node: mockOwner("face-1", ShapeTypes.face) },
                ]),
            ]);

            const node = (cmd as any).geometryNode() as CurveProjectionNode;

            expect(node).toBeInstanceOf(CurveProjectionNode);
            expect(node.shapeNodeId).toBe("curve-1");
            expect(node.faceNodeId).toBe("face-1");
            expect(node.dir).toBe("0,0,-1");
        });

        test("should propagate a configured dir to the node", () => {
            const cmd = new CurveProjectionCommand();
            cmd.dir = "0,1,0";
            wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.edge }, node: mockOwner("curve-1", ShapeTypes.edge) },
                ]),
                shapeStepResult([
                    { shape: { shapeType: ShapeTypes.face }, node: mockOwner("face-1", ShapeTypes.face) },
                ]),
            ]);

            const node = (cmd as any).geometryNode() as CurveProjectionNode;

            expect(node.dir).toBe("0,1,0");
        });
    });

    describe("executeMainTask", () => {
        test("should add the created node to the document without hiding either source", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CurveProjectionCommand();
                const { doc, addedNodes } = wireCommand(cmd);
                seedStepDatas(cmd, [
                    shapeStepResult([
                        {
                            shape: { shapeType: ShapeTypes.edge },
                            node: mockOwner("curve-1", ShapeTypes.edge),
                        },
                    ]),
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.face }, node: mockOwner("face-1", ShapeTypes.face) },
                    ]),
                ]);

                (cmd as any).executeMainTask();

                expect(addedNodes).toHaveLength(1);
                expect(addedNodes[0]).toBeInstanceOf(CurveProjectionNode);
                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });
    });

    describe("getSteps callbacks", () => {
        test("the second step should carry beforeSelection/afterSelection that update the first pick's highlight state", () => {
            const cmd = new CurveProjectionCommand();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.edge } }])]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
