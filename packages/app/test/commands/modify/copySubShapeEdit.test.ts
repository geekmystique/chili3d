// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CopySubShapeNode } from "../../../src/bodys/copySubShape";
import { CopySubShapeEditCommand } from "../../../src/commands/modify/copySubShapeEdit";
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
    const cmd = new CopySubShapeEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sourceNode = new EditableShapeNode({
        document: doc,
        name: "source",
        shape: mockShape({ shapeType: ShapeTypes.edge }) as unknown as IShape,
    });
    sourceNode.parent = parent;

    const targetNode = new CopySubShapeNode({
        document: doc,
        sourceNodeId: sourceNode.id,
        subShapeType: ShapeTypes.shape,
        index: -1,
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [sourceNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sourceNode, targetNode, nodes };
}

describe("CopySubShapeEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (CopySubShapeEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.copySubShapeEdit");
        expect(data.icon).toBe("icon-subShape");
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

        test("should find the target CopySubShapeNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect the source sub-shape and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newShape = mockShape({ shapeType: ShapeTypes.edge });
            const newSourceNode = new EditableShapeNode({
                document: doc,
                name: "newSource",
                shape: newShape as unknown as IShape,
            });
            nodes.push(newSourceNode);
            seedStepDatas(cmd, [shapeStepResult([{ shape: newShape as any, node: newSourceNode }])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sourceNodeId).toBe(newSourceNode.id);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing source when nothing was (re-)picked", () => {
            const { cmd, targetNode, sourceNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sourceNodeId).toBe(sourceNode.id);
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
