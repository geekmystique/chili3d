// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys } from "../command";
import { VisualConfig } from "../config";
import type { IDocument } from "../document";
import { type IEqualityComparer, Logger, PubSub, Result } from "../foundation";
import { I18n, type I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import {
    type EdgeMeshData,
    type FaceMeshData,
    type IShape,
    type IShapeMeshData,
    ShapeTypeUtils,
    type VertexMeshData,
} from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import type { IGraphNode } from "./dependencyGraph";
import { GeometryNode } from "./geometryNode";

const SHAPE_UNDEFINED = "Shape not initialized";

export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }
    set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    @property("common.shapeType")
    get shapeType(): string {
        if (!this._shape.isOk) {
            return this._shape.error;
        }

        return ShapeTypeUtils.stringValue(this._shape.value.shapeType);
    }

    protected setShape(shape: Result<IShape>) {
        if (this._shape.isOk && shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
        }

        // Store the result either way, including a failure - leaving the old,
        // now-stale shape in place on failure would make this node's own
        // .shape.isOk lie to everything that depends on it (both direct
        // callers checking it after an edit, and downstream nodes reading it
        // through resolveInput during propagate below), masking the break
        // instead of surfacing it.
        this._mesh = undefined;
        this.setProperty("shape", shape);
        // Optional chain: some test documents stand in a plain modelManager
        // object without a real DependencyGraph. Production documents always
        // have one.
        this.document.modelManager.dependencyGraph?.propagate(this.id);
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            Logger.warn(this.shape.error);
            return { edges: undefined, faces: undefined, vertexs: undefined };
        }
        const mesh = this.shape.value.mesh;
        this._originFaceMesh = mesh.faces;
        if (mesh.faces)
            mesh.faces = MeshUtils.mergeFaceMesh(
                mesh.faces,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
            );
        return mesh;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._shape.unchecked()?.dispose();
        this._shape = null as any;
    }
}

export class MultiShapeMesh implements IShapeMeshData {
    private readonly _vertexs: VertexMeshData;
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;

    get vertexs() {
        return this._vertexs.position.length > 0 ? this._vertexs : undefined;
    }

    get edges() {
        return this._edges.position.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.position.length > 0 ? this._faces : undefined;
    }

    constructor() {
        this._vertexs = {
            position: new Float32Array(),
            range: [],
            size: 0,
        };
        this._edges = {
            lineType: "solid",
            position: new Float32Array(),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };

        this._faces = {
            index: new Uint32Array(),
            normal: new Float32Array(),
            position: new Float32Array(),
            uv: new Float32Array(),
            range: [],
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    public addShape(shape: IShape, matrix: Matrix4) {
        const mesh = shape.mesh;
        const totleMatrix = shape.matrix.multiply(matrix);
        if (mesh.faces) {
            MeshUtils.combineFaceMeshData(this._faces, mesh.faces, totleMatrix);
        }
        if (mesh.edges) {
            MeshUtils.combineEdgeMeshData(this._edges, mesh.edges, totleMatrix);
        }
    }
}

export interface MultiShapeNodeOptions {
    document: IDocument;
    name: string;
    shapes: IShape[];
    materialId?: string;
    id?: string;
}

@serializable()
export class MultiShapeNode extends GeometryNode {
    private readonly _shapes: IShape[];
    @serialize()
    get shapes(): ReadonlyArray<IShape> {
        return this._shapes;
    }

    constructor(options: MultiShapeNodeOptions) {
        super({
            document: options.document,
            name: options.name,
            materialId: options.materialId,
            id: options.id,
        });
        this._shapes = options.shapes;
    }

    protected override createMesh(): IShapeMeshData {
        const meshes = new MultiShapeMesh();

        this._shapes.forEach((shape) => {
            meshes.addShape(shape, Matrix4.identity());
        });

        return meshes;
    }

    override display(): I18nKeys {
        return "body.multiShape";
    }
}

export interface ParameterShapeNodeOptions {
    document: IDocument;
    materialId?: string;
    id?: string;
}

export abstract class ParameterShapeNode extends ShapeNode {
    override get shape(): Result<IShape> {
        if (!this._shape.isOk && this._shape.error === SHAPE_UNDEFINED) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }
    override set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    protected setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.setShape(this.generateShape());
            return true;
        }

        return false;
    }

    constructor(options: ParameterShapeNodeOptions) {
        super({
            document: options.document,
            name: undefined as any,
            materialId: options.materialId,
            id: options.id,
        });
        this.setPrivateValue("name", I18n.translate(this.display()));
    }

    protected abstract generateShape(): Result<IShape>;
}

/**
 * A ParameterShapeNode whose generateShape() resolves other nodes by id
 * instead of holding a baked shape. `resolveInput` looks a node up through
 * the document (so it works whether the reference was set from a live node
 * at construction time, or from a plain id restored during deserialization,
 * when the referenced node may not exist yet at construction time but does
 * by the time the shape is first read). `subscribeTo` registers those ids
 * with the document's DependencyGraph, which recomputes this node whenever
 * a resolved input's own shape changes - directly, or several hops further
 * upstream - so edits propagate downstream automatically.
 */
export abstract class ReferenceShapeNode extends ParameterShapeNode implements IGraphNode {
    /**
     * The command that re-picks this node's references in place, if it has
     * one. A double-click on this node's timeline/tree entry invokes it,
     * pre-selecting this node so the command can find its target - see
     * CommandService.executeCommand. undefined means the node has no
     * re-pick flow yet.
     */
    get editCommandKey(): CommandKeys | undefined {
        return undefined;
    }

    /**
     * Replace a reference to oldId with newId, if this node references it
     * directly, and recompute. Returns whether anything changed. The
     * default does nothing; a subclass with reference fields (baseNodeId,
     * toolNodeIds, ...) overrides this to redirect whichever field(s)
     * match. Used by spliceIntoReferenceChain to splice a newly created
     * feature into an existing chain.
     */
    redirectReference(_oldId: string, _newId: string): boolean {
        return false;
    }

    /**
     * The node id this feature would collapse back into if it were deleted -
     * its own single "main" input (a fillet's base, an extrude's section, a
     * boolean's base). removeFromReferenceChain redirects this node's own
     * dependents there. The default is undefined - no single unambiguous
     * input - which makes removeFromReferenceChain refuse to delete a node
     * that still has dependents, rather than leave any of them pointing at a
     * missing id.
     */
    get primaryInputId(): string | undefined {
        return undefined;
    }

    protected resolveInput(id: string): ShapeNode | undefined {
        // Refuse a reference to this node itself, or to anything already
        // downstream of it (a node that - directly or transitively - depends
        // on this one). Either would create a cycle: a re-pick edit command
        // (e.g. BooleanEdit) doesn't otherwise stop a user from selecting the
        // very node being edited, or one of its own dependents, as a new
        // input, which would silently corrupt this node's shape (computed
        // against its own stale output) and the dependency graph (a self/
        // circular edge) with no error surfaced.
        if (id === this.id) return undefined;
        const graph = this.document.modelManager.dependencyGraph;
        if (graph?.getAllDependents(this.id).has(id)) return undefined;

        const node = this.document.modelManager.findNode((n) => n.id === id);
        return node instanceof ShapeNode ? node : undefined;
    }

    protected subscribeTo(nodes: ShapeNode[]) {
        this.document.modelManager.dependencyGraph?.setDependencies(
            this,
            nodes.map((n) => n.id),
        );
    }

    /** Called by the DependencyGraph once this node's dependencies are up to date. */
    recompute(): void {
        this.shape = this.generateShape();
    }

    override disposeInternal(): void {
        this.document.modelManager.dependencyGraph?.removeNode(this.id);
        super.disposeInternal();
    }
}

/**
 * Splice `newNode` into the chain in place of `oldNode`: every other node
 * that directly referenced oldNode (found through the DependencyGraph, so
 * this is a no-op without one) gets redirected to newNode instead, then
 * recomputes. Call this right after creating a feature that hides its own
 * base node (a new fillet on a body that already feeds a boolean, say), so
 * anything already downstream of that base picks up the new feature
 * instead of staying pinned to what it replaced.
 *
 * When something actually got redirected, newNode is no longer the end of
 * the chain - it hides itself too, the same way oldNode did, so only the
 * true downstream result stays visible. Returns whether that happened.
 */
export function spliceIntoReferenceChain(
    document: IDocument,
    oldNode: ShapeNode,
    newNode: ReferenceShapeNode,
): boolean {
    const graph = document.modelManager.dependencyGraph;
    if (!graph) return false;

    let spliced = false;
    // Batched: a direct dependent's own redirectReference() recomputes its
    // shape immediately, but the resulting downstream propagate() is deferred
    // until every dependent here has redirected, so a shared downstream node
    // (two redirected dependents reconverging further down) recomputes once,
    // against all of them already updated, instead of once per dependent.
    graph.suspend(() => {
        graph.getDirectDependents(oldNode.id).forEach((id) => {
            if (id === newNode.id) return;
            const dependent = document.modelManager.findNode((n) => n.id === id);
            if (
                dependent instanceof ReferenceShapeNode &&
                dependent.redirectReference(oldNode.id, newNode.id)
            ) {
                spliced = true;
            }
        });
    });

    if (spliced) newNode.visible = false;
    return spliced;
}

/**
 * Remove `node` from the chain, closing the gap: anything that referenced
 * `node` directly gets redirected to `node.primaryInputId` (its own single
 * main input) so those features keep working, and whichever of `node`'s own
 * inputs end up with no dependent left becomes visible again - nothing is
 * consuming it any more. This is the inverse of spliceIntoReferenceChain,
 * for deleting a feature out of the middle of a chain (or off the end of
 * one) rather than adding one.
 *
 * Refuses - returns false, without mutating anything - when `node` has
 * dependents but no primaryInputId to redirect them to (the base
 * ReferenceShapeNode default, for a node with several genuinely alternative
 * inputs and no single natural successor). `node` itself is removed through
 * the ordinary undo-tracked remove(), not disposed, so undoing this restores
 * it exactly like undoing any other deletion.
 */
export function removeFromReferenceChain(document: IDocument, node: ReferenceShapeNode): boolean {
    const graph = document.modelManager.dependencyGraph;
    const dependentIds = graph ? [...graph.getDirectDependents(node.id)] : [];
    const primaryId = node.primaryInputId;

    if (dependentIds.length > 0 && primaryId === undefined) return false;

    // See spliceIntoReferenceChain for why this is batched: without it, a
    // downstream node shared by two redirected dependents recomputes once per
    // dependent, the first time against a still-stale sibling.
    const redirectAll = () => {
        dependentIds.forEach((id) => {
            const dependent = document.modelManager.findNode((n) => n.id === id);
            if (dependent instanceof ReferenceShapeNode) dependent.redirectReference(node.id, primaryId!);
        });
    };
    if (graph) {
        graph.suspend(redirectAll);
    } else {
        redirectAll();
    }

    const upstreamIds = graph ? [...graph.getDirectDependencies(node.id)] : [];
    node.parent?.remove(node);

    upstreamIds.forEach((id) => {
        // The graph edge from `node` to `id` is left in place (node isn't
        // disposed, so undo can restore it exactly) - ignore it here so a
        // now-unused input isn't kept hidden by its own removed dependent.
        const stillNeeded = graph && [...graph.getDirectDependents(id)].some((depId) => depId !== node.id);
        if (stillNeeded) return;
        const upstream = document.modelManager.findNode((n) => n.id === id);
        if (upstream instanceof ShapeNode) upstream.visible = true;
    });

    return true;
}

export interface EditableShapeNodeOptions {
    document: IDocument;
    name: string;
    shape: IShape | Result<IShape>;
    materialId?: string | string[];
    id?: string;
}

@serializable()
export class EditableShapeNode extends ShapeNode {
    override display(): I18nKeys {
        return "body.editableShape";
    }

    @serialize()
    override get shape() {
        return this._shape;
    }

    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(options: EditableShapeNodeOptions) {
        super(options);
        this._shape = options.shape instanceof Result ? options.shape : Result.ok(options.shape);
    }
}
