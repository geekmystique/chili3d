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

    describe("getDirectDependents", () => {
        test("should return only one-hop dependents, not transitive ones", () => {
            // a -> b -> d ; a -> c -> d (same diamond as above)
            const graph = new DependencyGraph();
            const order: string[] = [];
            graph.setDependencies(node("b", order), ["a"]);
            graph.setDependencies(node("c", order), ["a"]);
            graph.setDependencies(node("d", order), ["b", "c"]);

            expect(graph.getDirectDependents("a")).toEqual(new Set(["b", "c"]));
            expect(graph.getDirectDependents("b")).toEqual(new Set(["d"]));
            expect(graph.getDirectDependents("d")).toEqual(new Set());
        });

        test("should return an empty set for a node with no dependents", () => {
            const graph = new DependencyGraph();
            expect(graph.getDirectDependents("nobody-depends-on-me")).toEqual(new Set());
        });
    });

    describe("orderAll", () => {
        function byCreatedOrder(order: Map<string, number>) {
            return (a: string, b: string) => order.get(a)! - order.get(b)!;
        }

        test("should place a retroactively-spliced dependency before its dependent, even though it was created later", () => {
            // Box1, Box2 created first; Boolean1 (base Box1, tool Box2) created next;
            // Fillet1 created last, targeting Box2, spliced in ahead of Boolean1 -
            // matches editing a fillet onto a boolean's already-consumed cutting tool.
            const graph = new DependencyGraph();
            const order: string[] = [];
            const createdOrder = new Map([
                ["box1", 1],
                ["box2", 2],
                ["boolean1", 3],
                ["fillet1", 4],
            ]);
            graph.setDependencies(node("boolean1", order), ["box1", "fillet1"]);
            graph.setDependencies(node("fillet1", order), ["box2"]);

            const result = graph.orderAll(
                ["box1", "box2", "boolean1", "fillet1"],
                byCreatedOrder(createdOrder),
            );

            expect(result).toEqual(["box1", "box2", "fillet1", "boolean1"]);
        });

        test("should tie-break unrelated nodes by createdOrder, unaffected by a dependency chain elsewhere", () => {
            const graph = new DependencyGraph();
            const order: string[] = [];
            const createdOrder = new Map([
                ["box1", 1],
                ["box2", 2],
                ["box3", 3],
                ["boolean1", 4],
                ["fillet1", 5],
            ]);
            graph.setDependencies(node("boolean1", order), ["box1", "fillet1"]);
            graph.setDependencies(node("fillet1", order), ["box2"]);
            // box3 has no dependency relationship to anything else in the set.

            const result = graph.orderAll(
                ["box1", "box2", "box3", "boolean1", "fillet1"],
                byCreatedOrder(createdOrder),
            );

            expect(result).toEqual(["box1", "box2", "box3", "fillet1", "boolean1"]);
        });

        test("should fall back to pure createdOrder when there are no edges at all among the given ids", () => {
            const graph = new DependencyGraph();
            const createdOrder = new Map([
                ["c", 3],
                ["a", 1],
                ["b", 2],
            ]);

            const result = graph.orderAll(["c", "a", "b"], byCreatedOrder(createdOrder));

            expect(result).toEqual(["a", "b", "c"]);
        });

        test("should still place every id even if tieBreak is never actually needed to decide anything", () => {
            const graph = new DependencyGraph();
            const order: string[] = [];
            graph.setDependencies(node("b", order), ["a"]);
            graph.setDependencies(node("c", order), ["b"]);

            const result = graph.orderAll(["a", "b", "c"], () => 0);

            expect(result).toEqual(["a", "b", "c"]);
        });
    });

    describe("getDirectDependencies", () => {
        test("should return only one-hop dependencies, not transitive ones", () => {
            // a -> b -> d ; a -> c -> d (same diamond as above)
            const graph = new DependencyGraph();
            const order: string[] = [];
            graph.setDependencies(node("b", order), ["a"]);
            graph.setDependencies(node("c", order), ["a"]);
            graph.setDependencies(node("d", order), ["b", "c"]);

            expect(graph.getDirectDependencies("d")).toEqual(new Set(["b", "c"]));
            expect(graph.getDirectDependencies("b")).toEqual(new Set(["a"]));
            expect(graph.getDirectDependencies("a")).toEqual(new Set());
        });

        test("should return an empty set for a node with no dependencies", () => {
            const graph = new DependencyGraph();
            expect(graph.getDirectDependencies("depends-on-nobody")).toEqual(new Set());
        });

        test("should reflect the latest setDependencies call, not accumulate", () => {
            const graph = new DependencyGraph();
            const order: string[] = [];
            const c = node("c", order);
            graph.setDependencies(c, ["a"]);
            graph.setDependencies(c, ["b"]);

            expect(graph.getDirectDependencies("c")).toEqual(new Set(["b"]));
        });
    });
});
