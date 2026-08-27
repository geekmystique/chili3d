// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface IGraphNode {
    readonly id: string;
    /** Recompute this node's own output. Called once its dependencies are up to date. */
    recompute(): void;
}

/**
 * Tracks "depends on" edges between shape nodes, keyed by node id, and
 * recomputes a changed node's transitive dependents - once each, in
 * dependency order - the same DAG-recompute pattern FreeCAD's document
 * object graph uses for its feature tree.
 *
 * This replaces a naive per-node onPropertyChanged subscription: with two
 * nodes feeding a shared dependent (e.g. a boolean feeding into another
 * boolean), a subscription-based approach recomputes the shared dependent
 * once per changed input - twice for one edit that touches both - and the
 * first of those recomputes runs against a still-stale sibling. Propagating
 * from a single entry point lets the whole affected subgraph be ordered
 * and each node recomputed exactly once, always against already-updated
 * inputs.
 */
export class DependencyGraph {
    private readonly _dependsOn = new Map<string, Set<string>>();
    private readonly _dependents = new Map<string, Set<string>>();
    private readonly _nodes = new Map<string, IGraphNode>();
    private _activePass = false;
    private _suspendDepth = 0;
    private readonly _pendingIds = new Set<string>();

    /** Replace `node`'s full set of dependencies with `dependsOnIds`. */
    setDependencies(node: IGraphNode, dependsOnIds: string[]) {
        this._nodes.set(node.id, node);
        this.clearDependencies(node.id);

        const deps = new Set(dependsOnIds);
        this._dependsOn.set(node.id, deps);
        deps.forEach((depId) => {
            let dependents = this._dependents.get(depId);
            if (!dependents) {
                dependents = new Set();
                this._dependents.set(depId, dependents);
            }
            dependents.add(node.id);
        });
    }

    /** Drop `id` from the graph entirely - its own dependencies and its entry as a dependency of others. */
    removeNode(id: string) {
        this.clearDependencies(id);
        this._dependents.get(id)?.forEach((dependentId) => {
            this._dependsOn.get(dependentId)?.delete(id);
        });
        this._dependents.delete(id);
        this._nodes.delete(id);
    }

    private clearDependencies(id: string) {
        const previous = this._dependsOn.get(id);
        previous?.forEach((depId) => this._dependents.get(depId)?.delete(id));
        this._dependsOn.delete(id);
    }

    /**
     * Recompute every transitive dependent of `changedId`, once each, in
     * dependency order. Re-entrant calls made while a pass is already
     * running (a dependent's own recompute() changing its shape, which the
     * running pass already scheduled) are no-ops: anything downstream of a
     * node already inside the current affected set is, transitively, also
     * inside it.
     *
     * While a suspend() batch is open, the call is deferred instead: `id` is
     * recorded and propagation runs once, for every deferred id together,
     * when the outermost suspend() ends.
     */
    propagate(changedId: string) {
        if (this._activePass) return;
        if (this._suspendDepth > 0) {
            this._pendingIds.add(changedId);
            return;
        }

        this.propagateMany([changedId]);
    }

    /**
     * Run `fn`, deferring every propagate() call made while it runs (directly,
     * or through nested suspend() calls) into a single combined pass once it
     * returns. Callers that redirect several sibling dependents in a loop -
     * spliceIntoReferenceChain, removeFromReferenceChain - use this so a
     * shared downstream node (a diamond: two redirected siblings reconverging
     * further down) is recomputed once, against every sibling's already-
     * updated input, instead of once per sibling against a still-stale one.
     */
    suspend<T>(fn: () => T): T {
        this._suspendDepth++;
        try {
            return fn();
        } finally {
            this._suspendDepth--;
            if (this._suspendDepth === 0 && this._pendingIds.size > 0) {
                const ids = [...this._pendingIds];
                this._pendingIds.clear();
                this.propagateMany(ids);
            }
        }
    }

    private propagateMany(changedIds: string[]) {
        const affected = new Set<string>();
        changedIds.forEach((id) => {
            this.collectDownstream(id).forEach((relatedId) => {
                affected.add(relatedId);
            });
        });
        if (affected.size === 0) return;

        const order = this.topologicalOrder(affected);
        this._activePass = true;
        try {
            order.forEach((id) => {
                this._nodes.get(id)?.recompute();
            });
        } finally {
            this._activePass = false;
        }
    }

    /** Every node transitively downstream of `id` (nodes that depend on it, directly or through others). */
    getAllDependents(id: string): Set<string> {
        return this.collectDownstream(id);
    }

    /** Nodes that depend directly on `id` (one hop only, not transitively). */
    getDirectDependents(id: string): Set<string> {
        return new Set(this._dependents.get(id));
    }

    /** Nodes `id` depends on directly (one hop only, not transitively). */
    getDirectDependencies(id: string): Set<string> {
        return new Set(this._dependsOn.get(id));
    }

    /** Every node `id` transitively depends on, directly or through others. */
    getAllDependencies(id: string): Set<string> {
        return this.collectUpstream(id);
    }

    private collectDownstream(startId: string): Set<string> {
        return this.collect(startId, this._dependents);
    }

    private collectUpstream(startId: string): Set<string> {
        return this.collect(startId, this._dependsOn);
    }

    private collect(startId: string, edges: Map<string, Set<string>>): Set<string> {
        const result = new Set<string>();
        const queue = [startId];
        while (queue.length > 0) {
            const id = queue.shift() as string;
            edges.get(id)?.forEach((relatedId) => {
                if (result.has(relatedId)) return;
                result.add(relatedId);
                queue.push(relatedId);
            });
        }
        return result;
    }

    /** Kahn's algorithm restricted to `affected`, ordering only by edges within that set. */
    private topologicalOrder(affected: Set<string>): string[] {
        const inDegree = new Map<string, number>();
        affected.forEach((id) => {
            const deps = this._dependsOn.get(id);
            let count = 0;
            deps?.forEach((depId) => {
                if (affected.has(depId)) count++;
            });
            inDegree.set(id, count);
        });

        const queue: string[] = [];
        inDegree.forEach((count, id) => {
            if (count === 0) queue.push(id);
        });

        const order: string[] = [];
        while (queue.length > 0) {
            const id = queue.shift() as string;
            order.push(id);
            this._dependents.get(id)?.forEach((dependentId) => {
                if (!affected.has(dependentId)) return;
                const remaining = (inDegree.get(dependentId) ?? 0) - 1;
                inDegree.set(dependentId, remaining);
                if (remaining === 0) queue.push(dependentId);
            });
        }

        if (order.length < affected.size) {
            // A cycle isn't reachable through the current UI (nothing lets a feature
            // reference something created after it), but recompute what's left rather
            // than silently dropping it if one ever slips through.
            affected.forEach((id) => {
                if (!order.includes(id)) order.push(id);
            });
        }

        return order;
    }
}
