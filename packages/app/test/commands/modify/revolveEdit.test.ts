// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, Line, PubSub, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { RevolvedNode } from "../../../src/bodys/revolve";
import { RevolveEditCommand } from "../../../src/commands/modify/revolveEdit";
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

function makeAxisEdgeShape() {
    return mockShape({
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { value: () => XYZ.zero, direction: XYZ.unitX } },
    } as any);
}

function buildEditCommand() {
    const cmd = new RevolveEditCommand();
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

    const targetNode = new RevolvedNode({
        document: doc,
        sectionNodeId: sectionNode.id,
        axis: new Line({ point: XYZ.zero, direction: XYZ.unitX }),
        angle: 360,
    });
    targetNode.parent = parent;

    const nodes: unknown[] = [sectionNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sectionNode, targetNode, nodes };
}

describe("RevolveEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (RevolveEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.revolveEdit");
        expect(data.icon).toBe("icon-revolve");
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

        test("should find the target RevolvedNode", async () => {
            const { cmd, targetNode } = buildEditCommand();
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect the section and axis, and recompute", () => {
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
            const axisShape = makeAxisEdgeShape();

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: newSectionShape as any, node: newSectionNode }]),
                shapeStepResult([{ shape: axisShape as any }]),
            ]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(newSectionNode.id);
            expect(targetNode.axis.direction.x).toBeCloseTo(1);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing section and axis when nothing was (re-)picked", () => {
            const { cmd, targetNode, sectionNode } = buildEditCommand();
            (cmd as any).targetNode = targetNode;
            const originalAxis = targetNode.axis;
            seedStepDatas(cmd, [shapeStepResult([]), shapeStepResult([])]);

            (cmd as any).executeMainTask();

            expect(targetNode.sectionNodeId).toBe(sectionNode.id);
            expect(targetNode.axis).toBe(originalAxis);
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
