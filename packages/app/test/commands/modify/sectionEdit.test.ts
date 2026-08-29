// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { SectionNode } from "../../../src/bodys/section";
import { SectionEditCommand } from "../../../src/commands/modify/sectionEdit";
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

function shapeShapeWithSection() {
    return mockShape({ shapeType: ShapeTypes.face, section: () => Result.ok(mockShape()) as any });
}

function buildEditCommand() {
    const cmd = new SectionEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const shapeNode = new EditableShapeNode({
        document: doc,
        name: "shape",
        shape: shapeShapeWithSection() as unknown as IShape,
    });
    const pathNode = new EditableShapeNode({
        document: doc,
        name: "path",
        shape: mockShape({ shapeType: ShapeTypes.face }) as unknown as IShape,
    });
    shapeNode.parent = parent;
    pathNode.parent = parent;

    const targetNode = new SectionNode({
        document: doc,
        shapeNodeId: shapeNode.id,
        shapeShapeType: ShapeTypes.shape,
        shapeIndex: -1,
        pathNodeId: pathNode.id,
        pathShapeType: ShapeTypes.shape,
        pathIndex: -1,
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [shapeNode, pathNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, shapeNode, pathNode, targetNode, nodes };
}

describe("SectionEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (SectionEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.sectionEdit");
        expect(data.icon).toBe("icon-section");
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

        test("should find the target SectionNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect both shape and path references, and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newShapeShape = shapeShapeWithSection();
            const newShapeNode = new EditableShapeNode({
                document: doc,
                name: "newShape",
                shape: newShapeShape as unknown as IShape,
            });
            const newPathShape = mockShape({ shapeType: ShapeTypes.face });
            const newPathNode = new EditableShapeNode({
                document: doc,
                name: "newPath",
                shape: newPathShape as unknown as IShape,
            });
            nodes.push(newShapeNode, newPathNode);
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: newShapeShape as any, node: newShapeNode }]),
                shapeStepResult([{ shape: newPathShape as any, node: newPathNode }]),
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.shapeNodeId).toBe(newShapeNode.id);
            expect(targetNode.pathNodeId).toBe(newPathNode.id);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing references when nothing was (re-)picked", () => {
            const { cmd, targetNode, shapeNode, pathNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd, [shapeStepResult([]), shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.shapeNodeId).toBe(shapeNode.id);
            expect(targetNode.pathNodeId).toBe(pathNode.id);
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
