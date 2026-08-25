// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ThickSolidNode } from "../../../src/bodys/thickSolid";
import { ThickSolidCommand } from "../../../src/commands/create/thickSolid";
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

function liveFaceNode(doc: IDocument) {
    const shape = mockShape({ shapeType: ShapeTypes.face });
    return new EditableShapeNode({
        document: doc,
        name: "face-source",
        shape: shape as unknown as IShape,
        materialId: "mat-1",
    });
}

describe("ThickSolidCommand", () => {
    test("should have command metadata", () => {
        const data = (ThickSolidCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.thickSolid");
        expect(data.icon).toBe("icon-thickSolid");
    });

    test("thickness should default to 10", () => {
        const cmd = new ThickSolidCommand();
        expect(cmd.thickness).toBe(10);
    });

    test("thickness setter should update property", () => {
        const cmd = new ThickSolidCommand();
        cmd.thickness = 20;
        expect(cmd.thickness).toBe(20);
    });

    test("getSteps should return one step", () => {
        const cmd = new ThickSolidCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should create one ThickSolidNode per selected face, referencing its source node", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);
                const parentA = doc.modelManager.rootNode as unknown as TrackingParent;
                const nodeA = liveFaceNode(doc);
                nodeA.parent = parentA;
                const nodeB = liveFaceNode(doc);
                const parentB = parentA;
                nodeB.parent = parentB;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [nodeA, nodeB].find(predicate);

                seedStepDatas(cmd, [
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.face }, node: nodeA },
                        { shape: { shapeType: ShapeTypes.face }, node: nodeB },
                    ]),
                ]);

                (cmd as any).executeMainTask();

                expect(parentA.insertedAfter).toHaveLength(2);
                expect(parentA.insertedAfter[0].target).toBe(nodeA);
                expect(parentA.insertedAfter[0].node).toBeInstanceOf(ThickSolidNode);
                expect((parentA.insertedAfter[0].node as ThickSolidNode).sectionNodeId).toBe(nodeA.id);
                expect(parentA.insertedAfter[1].target).toBe(nodeB);
                expect((parentA.insertedAfter[1].node as ThickSolidNode).sectionNodeId).toBe(nodeB.id);
                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });

        test("should propagate the configured thickness to the created node", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                cmd.thickness = 7;
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const node = liveFaceNode(doc);
                node.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [node].find(predicate);

                seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node }])]);

                (cmd as any).executeMainTask();

                expect((parent.insertedAfter[0].node as ThickSolidNode).thickness).toBe(7);
            } finally {
                restoreTx();
            }
        });

        test("should reference the sub-shape's type and index when the pick is one face of a multi-face pick", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const solidNode = liveFaceNode(doc);
                solidNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [solidNode].find(predicate);
                // ThickSolidNode.generateShape resolves sectionIndex via findSubShapes.
                Object.assign(solidNode.shape.value, {
                    findSubShapes: (type: number) =>
                        type === ShapeTypes.face ? [{ shapeType: ShapeTypes.face }] : [],
                });

                seedStepDatas(cmd, [
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.face, index: 0 } as any, node: solidNode },
                    ]),
                ]);

                (cmd as any).executeMainTask();

                const created = parent.insertedAfter[0].node as ThickSolidNode;
                expect(created.sectionNodeId).toBe(solidNode.id);
                expect(created.sectionShapeType).toBe(ShapeTypes.face);
                expect(created.sectionIndex).toBe(0);
            } finally {
                restoreTx();
            }
        });

        test("should publish an error toast and skip a face whose base node cannot be resolved", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const node = { id: "unregistered", parent } as any;
                // findNode stays the default (() => undefined), so the reference never resolves.

                seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node }])]);

                (cmd as any).executeMainTask();

                expect(parent.insertedAfter).toHaveLength(0);
                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.converter.error");
                expect(messages).toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                restoreTx();
            }
        });

        test("should publish the success toast on the happy path", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new ThickSolidCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const node = liveFaceNode(doc);
                node.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [node].find(predicate);

                seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node }])]);

                (cmd as any).executeMainTask();

                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                restoreTx();
            }
        });
    });
});
