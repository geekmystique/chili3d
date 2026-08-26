// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { LoftNode } from "../../../src/bodys/loft";
import { LoftEditCommand } from "../../../src/commands/modify/loftEdit";
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
    const cmd = new LoftEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sectionANode = new EditableShapeNode({
        document: doc,
        name: "sectionA",
        shape: mockShape({ shapeType: ShapeTypes.wire }) as unknown as IShape,
    });
    const sectionBNode = new EditableShapeNode({
        document: doc,
        name: "sectionB",
        shape: mockShape({ shapeType: ShapeTypes.wire }) as unknown as IShape,
    });
    sectionANode.parent = parent;
    sectionBNode.parent = parent;

    const targetNode = new LoftNode({
        document: doc,
        sectionNodeIds: [sectionANode.id, sectionBNode.id],
        sectionShapeTypes: [ShapeTypes.shape, ShapeTypes.shape],
        sectionIndexes: [-1, -1],
        isSolid: false,
        isRuled: false,
        continuity: "c0",
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [sectionANode, sectionBNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sectionANode, sectionBNode, targetNode, nodes };
}

describe("LoftEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (LoftEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.loftEdit");
        expect(data.icon).toBe("icon-loft");
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

        test("should find the target LoftNode and pick up its current options", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
            expect((cmd as any).isSolid).toBe(false);
            expect((cmd as any).continuity).toBe("c0");
        });
    });

    describe("executeMainTask", () => {
        test("should redirect to a new set of sections and options, and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            (cmd as any).isSolid = true;
            (cmd as any).continuity = "g1";

            const newSectionShape = mockShape({ shapeType: ShapeTypes.wire });
            const newSectionNode = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: newSectionShape as unknown as IShape,
            });
            nodes.push(newSectionNode);
            seedStepDatas(cmd, [shapeStepResult([{ shape: newSectionShape as any, node: newSectionNode }])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeIds).toEqual([newSectionNode.id]);
            expect(targetNode.isSolid).toBe(true);
            expect(targetNode.continuity).toBe("g1");
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing sections when nothing was (re-)picked", () => {
            const { cmd, targetNode, sectionANode, sectionBNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeIds).toEqual([sectionANode.id, sectionBNode.id]);
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
            seedStepDatas(cmd, [shapeStepResult([])]);
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
