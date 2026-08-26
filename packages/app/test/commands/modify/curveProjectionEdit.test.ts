// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CurveProjectionNode } from "../../../src/bodys/curveProjection";
import { CurveProjectionEditCommand } from "../../../src/commands/modify/curveProjectionEdit";
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
    const cmd = new CurveProjectionEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const curveNode = new EditableShapeNode({
        document: doc,
        name: "curve",
        shape: mockShape({ shapeType: ShapeTypes.edge }) as unknown as IShape,
    });
    const faceNode = new EditableShapeNode({
        document: doc,
        name: "face",
        shape: mockShape({ shapeType: ShapeTypes.face }) as unknown as IShape,
    });
    curveNode.parent = parent;
    faceNode.parent = parent;

    const targetNode = new CurveProjectionNode({
        document: doc,
        shapeNodeId: curveNode.id,
        shapeShapeType: ShapeTypes.shape,
        shapeIndex: -1,
        faceNodeId: faceNode.id,
        faceShapeType: ShapeTypes.shape,
        faceIndex: -1,
        dir: "0,0,-1",
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [curveNode, faceNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, curveNode, faceNode, targetNode, nodes };
}

describe("CurveProjectionEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (CurveProjectionEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.curveProjectionEdit");
        expect(data.icon).toBe("icon-curveProject");
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

        test("should find the target CurveProjectionNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect both curve and face references, and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newCurveShape = mockShape({ shapeType: ShapeTypes.edge });
            const newCurveNode = new EditableShapeNode({
                document: doc,
                name: "newCurve",
                shape: newCurveShape as unknown as IShape,
            });
            const newFaceShape = mockShape({ shapeType: ShapeTypes.face });
            const newFaceNode = new EditableShapeNode({
                document: doc,
                name: "newFace",
                shape: newFaceShape as unknown as IShape,
            });
            nodes.push(newCurveNode, newFaceNode);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: newCurveShape as any, node: newCurveNode }]),
                shapeStepResult([{ shape: newFaceShape as any, node: newFaceNode }]),
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.shapeNodeId).toBe(newCurveNode.id);
            expect(targetNode.faceNodeId).toBe(newFaceNode.id);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing references when nothing was (re-)picked", () => {
            const { cmd, targetNode, curveNode, faceNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([]), shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.shapeNodeId).toBe(curveNode.id);
            expect(targetNode.faceNodeId).toBe(faceNode.id);
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
