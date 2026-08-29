// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditableShapeNode, type IDocument, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { WireNode } from "../../../src/bodys/wire";
import { ConvertToWire } from "../../../src/commands/create/converter";
import { SelectionManager } from "../../../src/selectionManager";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../wasm/lib/chili-wasm.wasm"),
);

let restoreApp: () => void;
let factory: ShapeFactory;

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    factory = new ShapeFactory();

    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => ({ shapeProvider: { factory } }),
    });
    restoreApp = () => {
        if (previous) Object.defineProperty(globalThis, "app", previous);
    };
});

afterAll(() => restoreApp?.());

function lineNode(document: IDocument, name: string, x1: number, y1: number, x2: number, y2: number) {
    const edge = factory.line(new XYZ({ x: x1, y: y1, z: 0 }), new XYZ({ x: x2, y: y2, z: 0 }));
    if (!edge.isOk) throw new Error(edge.error);
    return new EditableShapeNode({ document, name, shape: edge.value });
}

function createDocument() {
    const doc = new TestDocument();
    doc.visual = createMockVisualWithDocument(doc);
    (doc.visual as any).document = doc;
    doc.selection = new SelectionManager(doc);
    return doc;
}

async function runConvertToWire(doc: IDocument) {
    const cmd = new ConvertToWire();
    (cmd as any)._application = { activeView: { document: doc } };
    await cmd.executeAsync();
}

function rootChildren(doc: IDocument) {
    return (doc.modelManager.rootNode as any).children() as unknown[];
}

/** The single visible WireNode among root's children - the current end-of-chain result. */
function visibleWire(doc: IDocument): WireNode {
    const wires = rootChildren(doc).filter((x): x is WireNode => x instanceof WireNode && x.visible);
    expect(wires).toHaveLength(1);
    return wires[0];
}

describe("ConvertToWire undo then redo conversion (real wasm)", () => {
    test("convert two edges to wire, undo, convert again", async () => {
        const doc = createDocument();
        const n1 = lineNode(doc, "l1", 0, 0, 10, 0);
        const n2 = lineNode(doc, "l2", 10, 0, 10, 10);
        doc.modelManager.rootNode.add(n1, n2);

        doc.selection.setSelectedNodes([n1, n2], false);
        await runConvertToWire(doc);

        // n1/n2 are hidden, not deleted - the new WireNode keeps a live reference to them.
        let children = rootChildren(doc);
        expect(children.length).toBe(3);
        expect(n1.visible).toBe(false);
        expect(n2.visible).toBe(false);
        expect(visibleWire(doc)).toBeDefined();

        doc.history.undo();
        children = rootChildren(doc);
        expect(children.length).toBe(2);
        expect(n1.visible).toBe(true);
        expect(n2.visible).toBe(true);

        doc.selection.setSelectedNodes([n1, n2], false);
        await runConvertToWire(doc);

        children = rootChildren(doc);
        expect(children.length).toBe(3);
        const wire = visibleWire(doc);
        expect(wire.shape.isOk).toBe(true);
        expect(wire.shape.value.shapeType).toBe(ShapeTypes.wire);
    });

    test("convert wire+edge, undo, convert again", async () => {
        const doc = createDocument();
        const n1 = lineNode(doc, "l1", 0, 0, 10, 0);
        const n2 = lineNode(doc, "l2", 10, 0, 10, 10);
        const n3 = lineNode(doc, "l3", 10, 10, 20, 10);
        doc.modelManager.rootNode.add(n1, n2, n3);

        // l1 + l2 -> W12 (n1, n2 hidden; n3 and W12 stay/become visible)
        doc.selection.setSelectedNodes([n1, n2], false);
        await runConvertToWire(doc);
        let children = rootChildren(doc);
        expect(children.length).toBe(4);
        const w12 = visibleWire(doc);

        // W12 + l3 -> W123 (w12, n3 hidden; W123 alone stays visible)
        doc.selection.setSelectedNodes([w12, n3], false);
        await runConvertToWire(doc);
        children = rootChildren(doc);
        expect(children.length).toBe(5);
        expect(w12.visible).toBe(false);
        expect(n3.visible).toBe(false);
        expect(visibleWire(doc)).toBeDefined();

        // undo -> w12 and l3 restored to visible, W123 removed
        doc.history.undo();
        children = rootChildren(doc);
        expect(children.length).toBe(4);
        expect(w12.visible).toBe(true);
        expect(n3.visible).toBe(true);
        expect(visibleWire(doc)).toBe(w12);

        // W12 + l3 -> W123 again
        doc.selection.setSelectedNodes([w12, n3], false);
        await runConvertToWire(doc);
        children = rootChildren(doc);
        expect(children.length).toBe(5);
        const w123 = visibleWire(doc);
        expect(w123).not.toBe(w12);
        expect(w123.shape.isOk).toBe(true);
        expect(w123.shape.value.findSubShapes(ShapeTypes.edge).length).toBe(3);
    });
});
