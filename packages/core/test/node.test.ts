// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, Id, type INode, NodeUtils } from "../src";
import { TestDocument } from "../test-utils";

function newNode(name: string, id?: string): INode {
    return {
        id: id ?? Id.generate(),
        name,
        visible: true,
        parentVisible: true,
        parent: undefined,
        previousSibling: undefined,
        nextSibling: undefined,
        onPropertyChanged: () => {},
        clearPropertyChanged() {},
        removePropertyChanged: () => {},
        clone: () => ({}) as any,
        dispose() {},
    };
}

describe("node", () => {
    const doc: IDocument = new TestDocument() as any;

    test("should get all nodes between two nodes", () => {
        const n1 = new FolderNode({ document: doc, name: "n1" });
        const n2 = new FolderNode({ document: doc, name: "n2" });
        const n3 = new FolderNode({ document: doc, name: "n3" });
        const n4 = new FolderNode({ document: doc, name: "n4" });
        const n5 = new FolderNode({ document: doc, name: "n5" });
        const n6 = new FolderNode({ document: doc, name: "n6" });
        const n7 = new FolderNode({ document: doc, name: "n7" });
        const n8 = new FolderNode({ document: doc, name: "n8" });
        const n9 = new FolderNode({ document: doc, name: "n9" });
        const n10 = new FolderNode({ document: doc, name: "n10" });
        const n11: INode = newNode("n11", "n11");
        // n1
        // ---n2
        //    ---n4
        // ---n3
        //    ---n5
        //    ---n6
        //       ---n7
        //       ---n8
        // ---n9
        // ---n10
        //    ---n11
        n1.add(n2, n3, n9, n10);
        n2.add(n4);
        n3.add(n5, n6);
        n6.add(n7, n8);
        n10.add(n11);
        let nodes = NodeUtils.getNodesBetween(n2, n4);
        expect(nodes.length).toBe(2);
        expect(nodes[0]).toBe(n2);
        expect(nodes[1]).toBe(n4);

        nodes = NodeUtils.getNodesBetween(n8, n3);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n3);

        nodes = NodeUtils.getNodesBetween(n7, n11);
        expect(nodes.length).toBe(5);
        expect(nodes[0]).toBe(n7);
        expect(nodes[4]).toBe(n11);
    });
});

describe("NodeUtils.nextNumberedName", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = new TestDocument() as any;
    });

    test("should return '1' when nothing of that name exists yet", () => {
        expect(NodeUtils.nextNumberedName(doc, "Box")).toBe("Box 1");
    });

    test("should number up past an existing numbered name", () => {
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box 1" }));
        expect(NodeUtils.nextNumberedName(doc, "Box")).toBe("Box 2");
    });

    test("should use one past the highest existing number, not fill gaps", () => {
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box 1" }));
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box 3" }));
        expect(NodeUtils.nextNumberedName(doc, "Box")).toBe("Box 4");
    });

    test("should ignore unrelated names, including ones that merely start with the base name", () => {
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Boxcar 1" }));
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box" }));
        expect(NodeUtils.nextNumberedName(doc, "Box")).toBe("Box 1");
    });

    test("should number each base name independently", () => {
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box 1" }));
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "Box 2" }));
        expect(NodeUtils.nextNumberedName(doc, "Extrude")).toBe("Extrude 1");
    });

    test("should treat regex-special characters in the base name literally", () => {
        doc.modelManager.addNode(new FolderNode({ document: doc, name: "C(1) 1" }));
        expect(NodeUtils.nextNumberedName(doc, "C(1)")).toBe("C(1) 2");
    });

    test("should fall back to '1' when the document's modelManager has no findNodes", () => {
        const bareDoc = { modelManager: {} } as unknown as IDocument;
        expect(NodeUtils.nextNumberedName(bareDoc, "Box")).toBe("Box 1");
    });
});

describe("node utils", () => {
    describe("NodeUtils Class Tests", () => {
        let doc: IDocument;

        beforeEach(() => {
            doc = new TestDocument() as any;
        });

        test("NodeUtils findNode functionality", () => {
            const parentNode = new FolderNode({ document: doc, name: "parent" });
            const child1 = newNode("child1");
            const child2 = new FolderNode({ document: doc, name: "child2" });
            const child3 = newNode("targetChild");
            const child4 = newNode("targetChild2");

            parentNode.add(child1, child2, child3);
            child2.add(child4);

            const foundNode = NodeUtils.findNode(parentNode, (node) => node.name === "targetChild");
            expect(foundNode).toBe(child3);

            const foundNode2 = NodeUtils.findNode(parentNode, (node) => node.name === "targetChild2");
            expect(foundNode2).toBe(child4);

            const notFound = NodeUtils.findNode(parentNode, (node) => node.name === "nonexistent");
            expect(notFound).toBeUndefined();
        });

        test("NodeUtils findNodes functionality", () => {
            const parentNode = new FolderNode({ document: doc, name: "parent" });
            const child1 = newNode("child1");
            const child2 = new FolderNode({ document: doc, name: "child2" });
            const child3 = newNode("specialChild");
            const child4 = newNode("specialChild2");

            parentNode.add(child1, child2, child3);
            child2.add(child4);

            const allNodes = NodeUtils.findNodes(parentNode);
            expect(allNodes).toHaveLength(4);
            expect(allNodes).toContain(child1);
            expect(allNodes).toContain(child2);
            expect(allNodes).toContain(child3);
            expect(allNodes).toContain(child4);

            const specialNodes = NodeUtils.findNodes(parentNode, (node) => node.name.includes("special"));
            expect(specialNodes).toHaveLength(2);
            expect(specialNodes).toContain(child3);
            expect(specialNodes).toContain(child4);
        });
    });
});
