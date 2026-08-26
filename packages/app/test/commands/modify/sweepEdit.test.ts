// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { SweepedNode } from "../../../src/bodys/sweep";
import { SweepEditCommand } from "../../../src/commands/modify/sweepEdit";
import {
    ensureGlobalStubApp,
    mockShape,
    seedStepDatas,
    shapeStepResult,
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
    const cmd = new SweepEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const pathNode = new EditableShapeNode({
        document: doc,
        name: "path",
        shape: mockShape({ shapeType: ShapeTypes.wire }) as unknown as IShape,
    });
    const profileNode = new EditableShapeNode({
        document: doc,
        name: "profile",
        shape: mockShape({ shapeType: ShapeTypes.wire }) as unknown as IShape,
    });
    pathNode.parent = parent;
    profileNode.parent = parent;

    const targetNode = new SweepedNode({
        document: doc,
        profileNodeIds: [profileNode.id],
        profileShapeTypes: [ShapeTypes.shape],
        profileIndexes: [-1],
        pathNodeId: pathNode.id,
        pathShapeType: ShapeTypes.shape,
        pathIndex: -1,
        round: false,
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [pathNode, profileNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, pathNode, profileNode, targetNode, nodes };
}

describe("SweepEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (SweepEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.sweepEdit");
        expect(data.icon).toBe("icon-sweep");
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

        test("should find the target SweepedNode and pick up its current round", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
            expect((cmd as any).round).toBe(false);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect path, profiles and round, and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            (cmd as any).round = true;

            const newPathShape = mockShape({ shapeType: ShapeTypes.wire });
            const newPathNode = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: newPathShape as unknown as IShape,
            });
            const newProfileShape = mockShape({ shapeType: ShapeTypes.wire });
            const newProfileNode = new EditableShapeNode({
                document: doc,
                name: "newProfile",
                shape: newProfileShape as unknown as IShape,
            });
            nodes.push(newPathNode, newProfileNode);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: newPathShape as any, node: newPathNode }]),
                shapeStepResult([{ shape: newProfileShape as any, node: newProfileNode }]),
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.pathNodeId).toBe(newPathNode.id);
            expect(targetNode.profileNodeIds).toEqual([newProfileNode.id]);
            expect(targetNode.round).toBe(true);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing path and profiles when nothing was (re-)picked", () => {
            const { cmd, targetNode, pathNode, profileNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([]), shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.pathNodeId).toBe(pathNode.id);
            expect(targetNode.profileNodeIds).toEqual([profileNode.id]);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should do nothing when there is no target node", () => {
            const { cmd, parent } = buildEditCommand();
            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(parent.added).toHaveLength(0);
        });

        test("should report a factory error via displayError", () => {
            const { cmd, targetNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([]), shapeStepResult([])]);
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
