// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ExtrudeNode } from "../../../src/bodys/extrude";
import { ExtrudeEditCommand } from "../../../src/commands/modify/extrudeEdit";
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
    const cmd = new ExtrudeEditCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sectionNode = new EditableShapeNode({
        document: doc,
        name: "section",
        shape: mockShape({
            shapeType: ShapeTypes.wire,
            findSubShapes: () => [],
            isClosed: () => false,
        }) as unknown as IShape,
    });
    sectionNode.parent = parent;

    const targetNode = new ExtrudeNode({ document: doc, sectionNodeId: sectionNode.id, length: 10 });
    targetNode.parent = parent;

    const nodes: unknown[] = [sectionNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sectionNode, targetNode, nodes };
}

describe("ExtrudeEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (ExtrudeEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.extrudeEdit");
        expect(data.icon).toBe("icon-prism");
    });

    describe("canExcute", () => {
        test("should report no selection and return false when nothing is selected", async () => {
            const { cmd, doc } = buildEditCommand();
            (doc.selection as any).getSelectedNodes = () => [];
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                const result = await (cmd as any).canExcute();
                expect(result).toBe(false);
                expect(pubSpy).toHaveBeenCalledWith("showToast", "toast.select.noSelected");
            } finally {
                pubSpy.mockRestore();
            }
        });

        test("should find the target ExtrudeNode and pick up its current length", async () => {
            const { cmd, targetNode } = buildEditCommand();
            const result = await (cmd as any).canExcute();
            expect(result).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
            expect((cmd as any).length).toBe(targetNode.length);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect the section and recompute when a new shape is picked", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand();
            (cmd as any).targetNode = targetNode;

            const newSectionShape = mockShape({
                shapeType: ShapeTypes.wire,
                findSubShapes: () => [],
                isClosed: () => false,
            });
            const newSectionNode = new EditableShapeNode({
                document: doc,
                name: "newSection",
                shape: newSectionShape as unknown as IShape,
            });
            nodes.push(newSectionNode);
            seedStepDatas(cmd, [shapeStepResult([{ shape: newSectionShape as any, node: newSectionNode }])]);

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

        test("should apply a newly typed length even when the section wasn't re-picked", () => {
            const { cmd, targetNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            (cmd as any).length = 42;
            seedStepDatas(cmd, [shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.length).toBe(42);
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

            const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
            Object.defineProperty(globalThis, "app", {
                configurable: true,
                value: { shapeProvider: { factory: { prism: () => Result.err("boom") } } },
            });
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                (cmd as any).executeMainTask();
                expect(pubSpy).toHaveBeenCalledWith("displayError", "boom");
            } finally {
                pubSpy.mockRestore();
                if (previous) Object.defineProperty(globalThis, "app", previous);
            }
        });
    });
});
