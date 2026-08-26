// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IShape,
    type IView,
    Plane,
    PubSub,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { BooleanNode } from "../../../src/bodys/boolean";
import { BooleanEditCommand } from "../../../src/commands/modify/booleanEdit";
import {
    ensureGlobalStubApp,
    mockShape,
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

const VIEW_STUB = {
    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
    type: "shape" as const,
};

function buildEditCommand() {
    const cmd = new BooleanEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const baseNode = new EditableShapeNode({
        document: doc,
        name: "base",
        shape: mockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape,
    });
    const toolNode = new EditableShapeNode({
        document: doc,
        name: "tool",
        shape: mockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape,
    });
    baseNode.parent = parent;
    toolNode.parent = parent;

    const targetNode = new BooleanNode({
        document: doc,
        operateType: "fuse",
        baseNodeId: baseNode.id,
        toolNodeIds: [toolNode.id],
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [baseNode, toolNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, baseNode, toolNode, targetNode, nodes };
}

describe("BooleanEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (BooleanEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.booleanEdit");
        expect(data.icon).toBe("icon-booleanCommon");
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

        test("should find the target BooleanNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect base and tools, and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newBase = new EditableShapeNode({
                document: doc,
                name: "newBase",
                shape: mockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape,
            });
            const newTool = new EditableShapeNode({
                document: doc,
                name: "newTool",
                shape: mockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape,
            });
            nodes.push(newBase, newTool);
            seedStepDatas(cmd, [
                { ...VIEW_STUB, shapes: [{ shape: newBase.shape.value }], nodes: [newBase] } as any,
                { ...VIEW_STUB, shapes: [{ shape: newTool.shape.value }], nodes: [newTool] } as any,
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.baseNodeId).toBe(newBase.id);
            expect(targetNode.toolNodeIds).toEqual([newTool.id]);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing base and tools when nothing was (re-)picked", () => {
            const { cmd, targetNode, baseNode, toolNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [
                { ...VIEW_STUB, shapes: [], nodes: [] } as any,
                { ...VIEW_STUB, shapes: [], nodes: [] } as any,
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.baseNodeId).toBe(baseNode.id);
            expect(targetNode.toolNodeIds).toEqual([toolNode.id]);
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
            seedStepDatas(cmd, [
                { ...VIEW_STUB, shapes: [], nodes: [] } as any,
                { ...VIEW_STUB, shapes: [], nodes: [] } as any,
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
