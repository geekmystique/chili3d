// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockEdgeCurve } from "@chili3d/core/test-utils";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { OffsetNode } from "../../../src/bodys/offset";
import { OffsetEditCommand } from "../../../src/commands/modify/offsetEdit";
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
    const cmd = new OffsetEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sectionNode = new EditableShapeNode({
        document: doc,
        name: "section",
        shape: mockShape({
            shapeType: ShapeTypes.edge,
            curve: createMockEdgeCurve(),
            offset: () => Result.ok(mockShape()),
        } as any) as unknown as IShape,
    });
    sectionNode.parent = parent;

    const targetNode = new OffsetNode({
        document: doc,
        sectionNodeId: sectionNode.id,
        distance: 5,
        normal: XYZ.unitZ,
        joinType: "arc",
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [sectionNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sectionNode, targetNode, nodes };
}

describe("OffsetEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (OffsetEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.offsetEdit");
        expect(data.icon).toBe("icon-offset");
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

        test("should find the target OffsetNode and pick up its current joinType", async () => {
            const { cmd, targetNode } = buildEditCommand();
            const result = await (cmd as any).canExcute();
            expect(result).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
            expect((cmd as any).joinType).toBe("option.command.joinType.arc");
        });
    });

    describe("executeMainTask", () => {
        test("should redirect the section, recompute the normal, and apply the new joinType", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            (cmd as any).joinType = "option.command.joinType.tangent";

            const newShape = mockShape({
                shapeType: ShapeTypes.edge,
                curve: createMockEdgeCurve(),
                offset: () => Result.ok(mockShape()),
            } as any);
            const newSectionNode = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: newShape as unknown as IShape,
            });
            nodes.push(newSectionNode);
            seedStepDatas(cmd, [shapeStepResult([{ shape: newShape as any, node: newSectionNode }])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(newSectionNode.id);
            expect(targetNode.joinType).toBe("tangent");
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing section and normal when nothing was (re-)picked", () => {
            const { cmd, targetNode, sectionNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            (cmd as any).joinType = "option.command.joinType.arc";
            const originalNormal = targetNode.normal;
            seedStepDatas(cmd, [shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(sectionNode.id);
            expect(targetNode.normal).toBe(originalNormal);
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
