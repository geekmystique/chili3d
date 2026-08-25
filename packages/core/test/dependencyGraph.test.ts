// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DependencyGraph, type IGraphNode } from "../src";

/** A mock IGraphNode that records its own id into a shared, cross-node order log. */
function node(id: string, order: string[]): IGraphNode {
    return {
        id,
        recompute: () => {
            order.push(id);
        },
    };
}

function countOf(order: string[], id: string) {
    return order.filter((x) => x === id).length;
}

describe("DependencyGraph", () => {
    test("should recompute a direct dependent when its dependency changes", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("b", order), ["a"]);

        graph.propagate("a");

        expect(order).toEqual(["b"]);
    });

    test("should do nothing when the changed node has no dependents", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("b", order), ["a"]);

        expect(() => graph.propagate("a-with-no-dependents")).not.toThrow();
        expect(order).toEqual([]);
    });

    test("should recompute a diamond's shared dependent exactly once, after both branches", () => {
        // a -> b -> d
        // a -> c -> d
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("b", order), ["a"]);
        graph.setDependencies(node("c", order), ["a"]);
        graph.setDependencies(node("d", order), ["b", "c"]);

        graph.propagate("a");

        expect(countOf(order, "b")).toBe(1);
        expect(countOf(order, "c")).toBe(1);
        expect(countOf(order, "d")).toBe(1);
        // d must run after both b and c, whichever order those two ran in
        expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("b"));
        expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("c"));
    });

    test("should recompute a longer chain in order", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("b", order), ["a"]);
        graph.setDependencies(node("c", order), ["b"]);

        graph.propagate("a");

        expect(order).toEqual(["b", "c"]);
    });

    test("removeNode should stop it from being recomputed and drop it as a dependency source", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("b", order), ["a"]);
        graph.setDependencies(node("c", order), ["b"]);

        graph.removeNode("b");
        graph.propagate("a");

        expect(order).toEqual([]); // c depended on b, which is gone
    });

    test("setDependencies should replace a node's previous dependency set, not add to it", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        const c = node("c", order);
        graph.setDependencies(c, ["a"]);
        graph.setDependencies(c, ["b"]); // c no longer depends on a

        graph.propagate("a");
        expect(order).toEqual([]);

        graph.propagate("b");
        expect(order).toEqual(["c"]);
    });

    test("should not recompute a node twice when propagate is called re-entrantly from within a pass", () => {
        // Simulates ShapeNode.setShape calling propagate() again from inside b's own
        // recompute() - the real trigger path once b's shape assignment goes through.
        const graph = new DependencyGraph();
        const order: string[] = [];
        const bNode: IGraphNode = {
            id: "b",
            recompute: () => {
                order.push("b");
                graph.propagate("b"); // re-entrant call while "a"'s pass is still running
            },
        };
        graph.setDependencies(bNode, ["a"]);
        graph.setDependencies(node("c", order), ["b"]);

        graph.propagate("a");

        expect(order).toEqual(["b", "c"]);
    });

    test("should not infinite-loop on a cycle, and still recompute every node in it", () => {
        const graph = new DependencyGraph();
        const order: string[] = [];
        graph.setDependencies(node("a", order), ["b"]);
        graph.setDependencies(node("b", order), ["a"]);

        expect(() => graph.propagate("a")).not.toThrow();
        expect(countOf(order, "a")).toBe(1);
        expect(countOf(order, "b")).toBe(1);
    });

    describe("getAllDependents / getAllDependencies", () => {
        // a -> b -> d
        // a -> c -> d
        function makeDiamond() {
            const graph = new DependencyGraph();
            const order: string[] = [];
            graph.setDependencies(node("b", order), ["a"]);
            graph.setDependencies(node("c", order), ["a"]);
            graph.setDependencies(node("d", order), ["b", "c"]);
            return graph;
        }

        test("getAllDependents should return every transitive downstream node", () => {
            const graph = makeDiamond();
            expect(graph.getAllDependents("a")).toEqual(new Set(["b", "c", "d"]));
            expect(graph.getAllDependents("b")).toEqual(new Set(["d"]));
            expect(graph.getAllDependents("d")).toEqual(new Set());
        });

        test("getAllDependencies should return every transitive upstream node", () => {
            const graph = makeDiamond();
            expect(graph.getAllDependencies("d")).toEqual(new Set(["b", "c", "a"]));
            expect(graph.getAllDependencies("b")).toEqual(new Set(["a"]));
            expect(graph.getAllDependencies("a")).toEqual(new Set());
        });

        test("should reflect removeNode, including stale references in the survivor's own dependency set", () => {
            const graph = makeDiamond();
            graph.removeNode("b");
            expect(graph.getAllDependents("a")).toEqual(new Set(["c", "d"]));
            // d no longer depends on the removed b, but it still depends on c,
            // which still depends on a - that part of the graph is untouched.
            expect(graph.getAllDependencies("d")).toEqual(new Set(["c", "a"]));
        });
    });
});
