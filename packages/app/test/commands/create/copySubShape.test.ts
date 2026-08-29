// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type IShape, PubSub, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CopySubShapeNode } from "../../../src/bodys/copySubShape";
import { CopySubShapeCommand } from "../../../src/commands/create/copySubShape";
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

function liveEdgeNode(doc: IDocument) {
    const shape = mockShape({ shapeType: ShapeTypes.edge });
    return new EditableShapeNode({
        document: doc,
        name: "edge-source",
        shape: shape as unknown as IShape,
        materialId: "mat-1",
    });
}

describe("CopySubShapeCommand", () => {
    test("should have command metadata", () => {
        const data = (CopySubShapeCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.copyShape");
        expect(data.icon).toBe("icon-subShape");
    });

    test("getSteps should return one multiple-selection step", () => {
        const cmd = new CopySubShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should create one CopySubShapeNode per selected shape, referencing its source node", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                const { doc } = wireCommand(cmd);
                const parentA = doc.modelManager.rootNode as unknown as TrackingParent;
                const nodeA = liveEdgeNode(doc);
                nodeA.parent = parentA;
                const nodeB = liveEdgeNode(doc);
                nodeB.parent = parentA;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [nodeA, nodeB].find(predicate);

                seedStepDatas(cmd, [
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.edge }, node: nodeA },
                        { shape: { shapeType: ShapeTypes.edge }, node: nodeB },
                    ]),
                ]);

                (cmd as any).executeMainTask();

                expect(parentA.insertedAfter).toHaveLength(2);
                expect(parentA.insertedAfter[0].target).toBe(nodeA);
                expect(parentA.insertedAfter[0].node).toBeInstanceOf(CopySubShapeNode);
                expect((parentA.insertedAfter[0].node as CopySubShapeNode).sourceNodeId).toBe(nodeA.id);
                expect(parentA.insertedAfter[1].target).toBe(nodeB);
                expect((parentA.insertedAfter[1].node as CopySubShapeNode).sourceNodeId).toBe(nodeB.id);
                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });

        test("should name the copy after the picked shape's type", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const node = liveEdgeNode(doc);
                node.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [node].find(predicate);

                seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, node }])]);

                (cmd as any).executeMainTask();

                const created = parent.insertedAfter[0].node as CopySubShapeNode;
                expect(created.name).toBe("Edge");
            } finally {
                restoreTx();
            }
        });

        test("should reference the sub-shape's type and index when the pick is a sub-shape of a solid", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new CopySubShapeCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const solidNode = liveEdgeNode(doc);
                solidNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [solidNode].find(predicate);
                // sweepRefFromPick resolves the sub-shape's index via findSubShapes +
                // isEqual. shapeStepResult wraps the picked shape through mockShape(),
                // which copies properties onto a fresh object, so isEqual can't rely on
                // reference equality - it has to compare a marker property that survives
                // the copy.
                Object.assign(solidNode.shape.value, {
                    shapeType: ShapeTypes.solid,
                    findSubShapes: (type: number) =>
                        type === ShapeTypes.face
                            ? [
                                  {
                                      shapeType: ShapeTypes.face,
                                      isEqual: (o: { marker?: string }) => o.marker === "picked",
                                  },
                              ]
                            : [],
                });

                seedStepDatas(cmd, [
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.face, marker: "picked" } as any, node: solidNode },
                    ]),
                ]);

                (cmd as any).executeMainTask();

                const created = parent.insertedAfter[0].node as CopySubShapeNode;
                expect(created.sourceNodeId).toBe(solidNode.id);
                expect(created.subShapeType).toBe(ShapeTypes.face);
                expect(created.index).toBe(0);
                expect(created.name).toBe("Face");
            } finally {
                restoreTx();
            }
        });

        test("should publish the success toast on the happy path", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new CopySubShapeCommand();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const node = liveEdgeNode(doc);
                node.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [node].find(predicate);

                seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, node }])]);

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
