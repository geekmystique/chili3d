// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, Matrix4, Plane, PubSub, Result, XYZ } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { PlacementNode } from "../../../src/bodys/placement";
import { PlacementRotateEditCommand } from "../../../src/commands/modify/placementRotateEdit";
import {
    ensureGlobalStubApp,
    mockShape,
    pointStepResult,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function buildEditCommand() {
    const cmd = new PlacementRotateEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const baseNode = new EditableShapeNode({
        document: doc,
        name: "base",
        shape: mockShape() as unknown as IShape,
    });
    baseNode.parent = parent as any;

    const targetNode = new PlacementNode({
        document: doc,
        baseNodeId: baseNode.id,
        kind: "rotate",
        delta: Matrix4.identity(),
    });
    targetNode.parent = parent as any;

    const nodes: unknown[] = [baseNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, baseNode, targetNode, nodes };
}

/** Rotate reads stepDatas[1].plane, so seed a plane-bearing step for the axis pick. */
function planeStepResult(point: XYZ, normal: XYZ) {
    return { ...pointStepResult({ point }), plane: new Plane({ origin: point, normal, xvec: XYZ.unitX }) };
}

describe("PlacementRotateEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (PlacementRotateEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.placementRotateEdit");
        expect(data.icon).toBe("icon-rotate");
    });

    describe("canExcute", () => {
        test("should return false when nothing is selected", async () => {
            const { cmd, doc } = buildEditCommand();
            (doc.selection as any).getSelectedNodes = () => [];
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                expect(await (cmd as any).canExcute()).toBe(false);
                expect(pubSpy).toHaveBeenCalledWith("showToast", "toast.select.noSelected");
            } finally {
                pubSpy.mockRestore();
            }
        });

        test("should find the target PlacementNode and seed models from its base", async () => {
            const { cmd, targetNode, baseNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
            expect((cmd as any).models).toEqual([baseNode]);
        });
    });

    describe("executeMainTask", () => {
        test("should replace the delta and recompute", () => {
            const { cmd, targetNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [
                pointStepResult({ point: XYZ.zero }),
                planeStepResult(new XYZ({ x: 1, y: 0, z: 0 }), XYZ.unitZ),
                pointStepResult({ point: new XYZ({ x: 0, y: 1, z: 0 }) }),
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should do nothing when there is no target node", () => {
            const { cmd, parent } = buildEditCommand();
            seedStepDatas(cmd, [
                pointStepResult({ point: XYZ.zero }),
                planeStepResult(new XYZ({ x: 1, y: 0, z: 0 }), XYZ.unitZ),
                pointStepResult({ point: new XYZ({ x: 0, y: 1, z: 0 }) }),
            ]);
            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(parent.added).toHaveLength(0);
        });

        test("should report a factory error via displayError", () => {
            const { cmd, targetNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [
                pointStepResult({ point: XYZ.zero }),
                planeStepResult(new XYZ({ x: 1, y: 0, z: 0 }), XYZ.unitZ),
                pointStepResult({ point: new XYZ({ x: 0, y: 1, z: 0 }) }),
            ]);
            (targetNode as any).generateShape = () => Result.err("boom");

            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                (cmd as any).executeMainTask();
                expect(pubSpy).toHaveBeenCalledWith("displayError", "boom");
            } finally {
                pubSpy.mockRestore();
            }
        });
    });
});
