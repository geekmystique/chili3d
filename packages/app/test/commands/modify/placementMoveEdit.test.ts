// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, Matrix4, PubSub, Result, XYZ } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { PlacementNode } from "../../../src/bodys/placement";
import { PlacementMoveEditCommand } from "../../../src/commands/modify/placementMoveEdit";
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
    const cmd = new PlacementMoveEditCommand();
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
        kind: "move",
        delta: Matrix4.fromTranslation(1, 0, 0),
    });
    targetNode.parent = parent as any;

    const nodes: unknown[] = [baseNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, baseNode, targetNode, nodes };
}

describe("PlacementMoveEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (PlacementMoveEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.placementMoveEdit");
        expect(data.icon).toBe("icon-move");
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
                pointStepResult({ point: new XYZ({ x: 5, y: 6, z: 7 }) }),
            ]);

            (cmd as any).executeMainTask();

            const expected = Matrix4.fromTranslation(5, 6, 7);
            for (let i = 0; i < 16; i++) {
                expect(targetNode.delta.array[i]).toBeCloseTo(expected.array[i], 6);
            }
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should do nothing when there is no target node", () => {
            const { cmd, parent } = buildEditCommand();
            seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero }), pointStepResult({ point: XYZ.zero })]);
            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(parent.added).toHaveLength(0);
        });

        test("should report a factory error via displayError", () => {
            const { cmd, targetNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero }), pointStepResult({ point: XYZ.zero })]);
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
