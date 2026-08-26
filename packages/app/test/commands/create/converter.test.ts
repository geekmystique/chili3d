// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, Matrix4, ShapeTypes, type VisualNode } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CompoundNode } from "../../../src/bodys/compound";
import { FaceNode } from "../../../src/bodys/face";
import { ShellNode } from "../../../src/bodys/shell";
import { SolidNode } from "../../../src/bodys/solid";
import { WireNode } from "../../../src/bodys/wire";
import {
    ConvertToCompound,
    ConvertToFace,
    ConvertToShell,
    ConvertToSolid,
    ConvertToWire,
} from "../../../src/commands/create/converter";
import {
    ensureGlobalStubApp,
    mockShape,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function stubDocumentSelection(doc: IDocument, nodes: VisualNode[]) {
    (doc.selection as any).getSelectedNodes = () => nodes;
}

/**
 * Build an EditableShapeNode for each shape and wire `doc.modelManager.findNode`
 * to resolve them by id, so a converted node's generateShape() (which looks
 * sources up by id) can find them the same way it would against a real document.
 */
function installSourceNodes(
    doc: ReturnType<typeof wireCommand>["doc"],
    shapes: ReturnType<typeof mockShape>[],
) {
    const nodes = shapes.map((shape, i) => new EditableShapeNode({ document: doc, name: `src${i}`, shape }));
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    return nodes;
}

describe("ConvertToWire", () => {
    test("should have command metadata", () => {
        const data = (ConvertToWire as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toWire");
        expect(data.icon).toBe("icon-toPoly");
    });

    test("shapeFilter should allow edges", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
    });

    test("shapeFilter should allow wires", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
    });

    test("shapeFilter should reject faces", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
    });

    test("create should return a reference-based WireNode", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.edge,
                transformedMul: () => mockShape({ shapeType: ShapeTypes.edge }) as any,
            });
            const [node] = installSourceNodes(doc, [shape]);
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(WireNode);
            expect((result.value as WireNode).sourceNodeIds).toEqual([node.id]);
        } finally {
            restoreTx();
        }
    });

    describe("_getSelectedModels", () => {
        test("should return nodes matching the shape filter", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.edge });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(1);
        });

        test("should filter out nodes with no shape", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const node = { shape: { value: undefined } };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(0);
        });

        test("should filter out nodes not matching the shape filter", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.face });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(0);
        });
    });

    describe("executeAsync", () => {
        test("should hide (not delete) the consumed nodes and keep the new node referencing them", async () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ConvertToWire();
                const { doc } = wireCommand(cmd);
                const shape = mockShape({
                    shapeType: ShapeTypes.edge,
                    transformedMul: () => mockShape({ shapeType: ShapeTypes.edge }) as any,
                });
                const [node] = installSourceNodes(doc, [shape]);
                stubDocumentSelection(doc, [node as unknown as VisualNode]);

                await cmd.executeAsync();

                const rootNode = doc.modelManager.rootNode as unknown as TrackingParent;
                expect(rootNode.added).toHaveLength(1);
                expect(rootNode.added[0]).toBeInstanceOf(WireNode);
                expect(node.visible).toBe(false);
                expect(node.parent).toBeUndefined();
            } finally {
                restoreTx();
            }
        });
    });
});

describe("ConvertToFace", () => {
    test("should have command metadata", () => {
        const data = (ConvertToFace as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toFace");
        expect(data.icon).toBe("icon-toFace");
    });

    test("shapeFilter should allow edges and wires", () => {
        const cmd = new ConvertToFace();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
    });

    test("create should return a reference-based FaceNode", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToFace();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.wire,
                isClosed: () => true,
                findSubShapes: () => [],
                transformedMul: () =>
                    mockShape({
                        shapeType: ShapeTypes.wire,
                        isClosed: () => true,
                        findSubShapes: () => [],
                    }) as any,
            });
            const [node] = installSourceNodes(doc, [shape]);
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(FaceNode);
        } finally {
            restoreTx();
        }
    });
});

describe("ConvertToShell", () => {
    test("should have command metadata", () => {
        const data = (ConvertToShell as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toShell");
        expect(data.icon).toBe("icon-toShell");
    });

    test("shapeFilter should allow only faces", () => {
        const cmd = new ConvertToShell();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(false);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
    });

    test("create should return a reference-based ShellNode", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToShell();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.face,
                transformedMul: () => mockShape({ shapeType: ShapeTypes.face }) as any,
            });
            const [node] = installSourceNodes(doc, [shape]);
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(ShellNode);
        } finally {
            restoreTx();
        }
    });
});

describe("ConvertToSolid", () => {
    test("should have command metadata", () => {
        const data = (ConvertToSolid as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toSolid");
        expect(data.icon).toBe("icon-toSolid");
    });

    test("shapeFilter should allow only shells", () => {
        const cmd = new ConvertToSolid();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(false);
    });

    test("create should return a reference-based SolidNode", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToSolid();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.shell,
                transformedMul: () => mockShape({ shapeType: ShapeTypes.shell }) as any,
            });
            const [node] = installSourceNodes(doc, [shape]);
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(SolidNode);
        } finally {
            restoreTx();
        }
    });

    describe("_getSelectedModels", () => {
        test("should filter by shell shape type", () => {
            const cmd = new ConvertToSolid();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.shell });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(1);
        });

        test("should reject non-shell shapes", () => {
            const cmd = new ConvertToSolid();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.face });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(0);
        });
    });
});

describe("ConvertToCompound", () => {
    test("should have command metadata", () => {
        const data = (ConvertToCompound as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toCompound");
        expect(data.icon).toBe("icon-compound");
    });

    test("shapeFilter should allow any shape type", () => {
        const cmd = new ConvertToCompound();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.solid } as any)).toBe(true);
    });

    test("create should return a reference-based CompoundNode", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToCompound();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.solid,
                transformedMul: () => mockShape({ shapeType: ShapeTypes.solid }) as any,
            });
            const [node] = installSourceNodes(doc, [shape]);
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(CompoundNode);
        } finally {
            restoreTx();
        }
    });

    describe("_getSelectedModels", () => {
        test("should keep nodes of any shape type", () => {
            const cmd = new ConvertToCompound();
            const { doc } = wireCommand(cmd);
            const node = {
                shape: { value: mockShape({ shapeType: ShapeTypes.solid }) },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(1);
        });
    });
});
