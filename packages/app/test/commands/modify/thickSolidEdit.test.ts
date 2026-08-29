// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ThickSolidNode } from "../../../src/bodys/thickSolid";
import { ThickSolidEditCommand } from "../../../src/commands/modify/thickSolidEdit";
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
    const cmd = new ThickSolidEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sectionNode = new EditableShapeNode({
        document: doc,
        name: "section",
        shape: mockShape({ shapeType: ShapeTypes.face }) as unknown as IShape,
    });
    sectionNode.parent = parent;

    const targetNode = new ThickSolidNode({ document: doc, sectionNodeId: sectionNode.id, thickness: 2 });
    targetNode.parent = parent;

    const nodes: unknown[] = [sectionNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sectionNode, targetNode, nodes };
}

describe("ThickSolidEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (ThickSolidEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.thickSolidEdit");
        expect(data.icon).toBe("icon-thickSolid");
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

        test("should find the target ThickSolidNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect the section and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newShape = mockShape({ shapeType: ShapeTypes.face });
            const newSectionNode = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: newShape as unknown as IShape,
            });
            nodes.push(newSectionNode);
            seedStepDatas(cmd, [shapeStepResult([{ shape: newShape as any, node: newSectionNode }])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(newSectionNode.id);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing section when nothing was (re-)picked", () => {
            const { cmd, targetNode, sectionNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(sectionNode.id);
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
