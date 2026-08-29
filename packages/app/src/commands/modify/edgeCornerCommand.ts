// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    GeometryUtils,
    I18n,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeFilter,
    type IStep,
    type ISubEdgeShape,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    MultistepCommand,
    Precision,
    PubSub,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    SnapEventHandler,
    spliceIntoReferenceChain,
    Transaction,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { EdgeCornerNode, type EdgeCornerOperateType } from "../../bodys/edgeCorner";

const SOLID_PARENT_TYPES: ShapeType[] = [ShapeTypes.solid, ShapeTypes.compound, ShapeTypes.compoundSolid];
const PLANAR_PARENT_TYPES: ShapeType[] = [ShapeTypes.face, ShapeTypes.wire, ShapeTypes.edge];
const SUPPORTED_PARENT_TYPES: ShapeType[] = [...SOLID_PARENT_TYPES, ...PLANAR_PARENT_TYPES];

/**
 * Whether the parent body holds planar geometry. A compound is classified by
 * its content: containing a solid makes it 3D, otherwise (faces, wires or
 * edges inside) it is treated as 2D.
 */
export function isPlanarParent(parent: IShape): boolean {
    if (PLANAR_PARENT_TYPES.includes(parent.shapeType)) return true;
    return parent.shapeType === ShapeTypes.compound && parent.findSubShapes(ShapeTypes.solid).length === 0;
}

/**
 * The face an edge belongs to: the parent itself when it is a face, or the
 * containing face inside a compound; undefined for wire/edge parents.
 */
export function faceContaining(parent: IShape, sub: ISubEdgeShape): IFace | undefined {
    if (parent.shapeType === ShapeTypes.face) return parent as IFace;
    if (parent.shapeType !== ShapeTypes.compound) return undefined;

    const faces = parent.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.find((face) => (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((e) => e.isEqual(sub)));
}

/** Two adjacent sub-edges of a wire, ordered along the wire flow. */
export interface OrderedCorner {
    edge1: IEdge;
    edge2: IEdge;
    index1: number;
    index2: number;
}

/** Order the two sub-edges along the wire flow (handles the closed-wire wrap). */
export function orderCornerEdges(
    allEdges: IEdge[],
    sub1: ISubEdgeShape,
    sub2: ISubEdgeShape,
): OrderedCorner | undefined {
    const n = allEdges.length;
    let index1 = allEdges.findIndex((x) => x.isEqual(sub1));
    let index2 = allEdges.findIndex((x) => x.isEqual(sub2));
    if (index1 < 0 || index2 < 0) return undefined;

    let [edge1, edge2] = [sub1, sub2] as IEdge[];
    if ((index1 + 1) % n !== index2) {
        [edge1, edge2] = [edge2, edge1];
        [index1, index2] = [index2, index1];
    }
    return { edge1, edge2, index1, index2 };
}

/**
 * Replace a shape node by an EditableShapeNode holding the new shape, keeping
 * the name, material, transform and position in the node tree. When the node
 * already is an EditableShapeNode only its shape is swapped.
 */
export function replaceShapeNode(node: ShapeNode, shape: IShape) {
    if (node instanceof EditableShapeNode) {
        node.shape = Result.ok(shape);
    } else {
        const model = new EditableShapeNode({
            document: node.document,
            name: node.name,
            shape,
            materialId: node.materialId,
        });
        model.transform = node.transform;

        (node.parent ?? node.document.modelManager.rootNode).add(model);
        node.parent?.remove(node);
    }

    node.document.visual.update();
}

/** Splice the corner triple into the wire edges in place of the two old edges. */
function spliceCornerEdges(allEdges: IEdge[], corner: OrderedCorner, triple: IEdge[]): IEdge[] {
    const [trimmed1, cornerEdge, trimmed2] = triple;
    const { index1, index2 } = corner;
    if (index1 === allEdges.length - 1) {
        // closed-wire wrap: the corner spans the last and the first edge
        return [trimmed2, ...allEdges.slice(1, -1), trimmed1, cornerEdge];
    }
    return [...allEdges.slice(0, index1), trimmed1, cornerEdge, trimmed2, ...allEdges.slice(index2 + 1)];
}

/**
 * Base class for the chamfer and fillet commands. Both reshape the corner of
 * the selected edges - on a solid or a compound of solids (3D), on a face or
 * a compound of faces (2D), on a wire, or between two standalone edge
 * bodies - and differ only in the actual shape operation, provided by the
 * `applyTo*` methods.
 */
export abstract class EdgeCornerCommand extends MultistepCommand {
    /** "fillet" or "chamfer" - which EdgeCornerNode operation a solid/compound edit produces. */
    protected abstract get operateType(): EdgeCornerOperateType;

    /** The configured radius (fillet) or distance (chamfer) for a solid/compound edit. */
    protected abstract get cornerValue(): number;
    /** Sets cornerValue directly (no SnapEventHandler finish side effect) - used by the drag step's live preview. */
    protected abstract set cornerValue(value: number);

    /** The tip shown while dragging to set cornerValue - "input radius..." for Fillet, generic for Chamfer. */
    protected get cornerValuePromptKey(): I18nKeys {
        return "prompt.pickNextPoint";
    }

    /**
     * A value typed into the radius/length box before the drag step has
     * actually started (still picking edges) - applied the instant that
     * step's SnapEventHandler exists (see getCornerValueStepData), instead
     * of requiring the user to also interact with the drag step once it
     * begins. Cleared once applied.
     */
    private pendingTypedValue?: string;

    /**
     * Called by the radius/length public setter each subclass exposes, with
     * whether the value actually changed (setProperty's return).
     *
     * While the drag step is already active, an actual change finishes it
     * immediately with the typed value, exactly like clicking/releasing a
     * drag - but an unchanged value is ignored there, so an incidental blur/
     * tab-away while genuinely dragging can't accidentally end the command
     * (same guard Extrude's length setter already relies on).
     *
     * Otherwise (still picking edges), queues the value for the instant the
     * drag step starts - unconditionally, changed or not: queuing by itself
     * has no effect on anything until the pick step later finishes some
     * other, already-deliberate way (Enter/checkmark/Ctrl), so pressing Enter
     * to accept the already-suggested default still finishes the command,
     * instead of silently doing nothing because the value "didn't change".
     */
    protected applyOrQueueTypedValue(value: number, changed: boolean): void {
        const view = this.document.application.activeView;
        const handler = this.document.visual.eventHandler;
        if (view && handler instanceof SnapEventHandler) {
            if (changed) handler.applyTypedInput(view, String(value));
        } else {
            this.pendingTypedValue = String(value);
        }
    }

    /** Apply the operation to the corner between two edges of a face. */
    protected abstract applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape>;

    /** Trim two adjacent edges and return [trimmed1, cornerEdge, trimmed2]. */
    protected abstract applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]>;

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shapes = this.stepDatas[0].shapes;
            const parent = (shapes[0].shape as ISubEdgeShape).parent;

            if (parent.shapeType === ShapeTypes.edge) {
                this.modifyStandaloneEdges(shapes);
                return;
            }

            this.modifyNode(shapes, parent);
        });
    }

    private modifyNode(shapes: VisualShapeData[], parent: IShape) {
        const node = shapes[0].owner.node as ShapeNode;

        if (!isPlanarParent(parent)) {
            this.modifyBodyNode(shapes, node);
            return;
        }

        const newShape = this.computePlanarShape(shapes, parent);
        if (!newShape.isOk) {
            PubSub.default.pub("displayError", newShape.error);
            return;
        }

        replaceShapeNode(node, newShape.value);
    }

    /**
     * A solid/compound edit becomes a live EdgeCornerNode referencing `node`
     * by id, rather than a baked shape - editing `node`'s own parameters
     * later recomputes this feature. `node` is hidden, not deleted, so the
     * reference stays resolvable.
     */
    private modifyBodyNode(shapes: VisualShapeData[], node: ShapeNode) {
        const edgeIndexes = shapes.map((x) => (x.shape as ISubEdgeShape).index);
        const featureNode = new EdgeCornerNode({
            document: this.document,
            operateType: this.operateType,
            baseNodeId: node.id,
            edgeIndexes,
            value: this.cornerValue,
        });
        // Keep the base's material, but not its name - unlike replaceShapeNode
        // below (which reshapes the SAME node identity in place), this is a
        // new feature entering the timeline as its own step, so it keeps the
        // numbered "Fillet N"/"Chamfer N" name EdgeCornerNode's own
        // constructor already assigned it, rather than the base's own name
        // (confusing once the base is hidden - the fillet would look like a
        // second copy of the object it was cut from, not a feature of it).
        featureNode.materialId = node.materialId;

        if (!featureNode.shape.isOk) {
            PubSub.default.pub("displayError", featureNode.shape.error);
            featureNode.dispose();
            return;
        }

        const container = node.parent ?? this.document.modelManager.rootNode;
        container.insertAfter(node, featureNode);
        node.visible = false;
        // node may already feed other features (a boolean, say) - point those at
        // the new fillet/chamfer instead of the now-hidden, un-corner-ed node.
        spliceIntoReferenceChain(this.document, node, featureNode);
        this.document.visual.update();
    }

    private computePlanarShape(shapes: VisualShapeData[], parent: IShape): Result<IShape> {
        if (shapes.length !== 2) {
            return Result.err(I18n.translate("error.select.twoEdges"));
        }

        const face = faceContaining(parent, shapes[0].shape as ISubEdgeShape);
        return face !== undefined
            ? this.applyToFace(face, shapes[0].shape as IEdge, shapes[1].shape as IEdge)
            : this.modifyWireCorner(
                  parent,
                  shapes[0].shape as ISubEdgeShape,
                  shapes[1].shape as ISubEdgeShape,
              );
    }

    /** Modify the corner between two adjacent edges of a wire and rebuild the wire. */
    private modifyWireCorner(wire: IShape, sub1: ISubEdgeShape, sub2: ISubEdgeShape): Result<IShape> {
        const allEdges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        const corner = orderCornerEdges(allEdges, sub1, sub2);
        if (corner === undefined) return Result.err("Edges must belong to the wire.");

        const triple = this.applyToEdgePair(corner.edge1, corner.edge2);
        if (!triple.isOk) return triple.parse();

        return shapeFactory.wire(spliceCornerEdges(allEdges, corner, triple.value));
    }

    /** Apply the corner between two standalone edge bodies, keeping them as separate edges. */
    private modifyStandaloneEdges(shapes: VisualShapeData[]) {
        if (shapes.length !== 2) {
            PubSub.default.pub("displayError", I18n.translate("error.select.twoEdges"));
            return;
        }

        const [edge1, edge2] = shapes.map((x) => {
            const edge = x.shape.transformedMul(x.transform) as IEdge;
            this.disposeStack.add(edge);
            return edge;
        });

        const triple = this.applyToEdgePair(edge1, edge2);
        if (!triple.isOk) {
            PubSub.default.pub("displayError", triple.error);
            return;
        }

        this.replaceStandaloneNodes(shapes, triple.value);
    }

    /**
     * Replace the two standalone edge nodes by their trimmed versions and add
     * the corner edge as a third standalone edge. The triple's geometry is in
     * world space (the transforms were baked in), so no transform is copied.
     */
    private replaceStandaloneNodes(shapes: VisualShapeData[], triple: IEdge[]) {
        const [trimmed1, cornerEdge, trimmed2] = triple;
        const node1 = shapes[0].owner.node as ShapeNode;
        const node2 = shapes[1].owner.node as ShapeNode;
        const container1 = node1.parent ?? this.document.modelManager.rootNode;
        const container2 = node2.parent ?? this.document.modelManager.rootNode;

        container1.add(this.standaloneEdgeNode(node1, trimmed1));
        container2.add(this.standaloneEdgeNode(node2, trimmed2));
        container1.add(this.standaloneEdgeNode(node1, cornerEdge, `${node1.name}_1`));
        node1.parent?.remove(node1);
        node2.parent?.remove(node2);
        this.document.visual.update();
    }

    private standaloneEdgeNode(source: ShapeNode, shape: IEdge, name?: string) {
        return new EditableShapeNode({
            document: this.document,
            name: name ?? source.name,
            shape,
            materialId: source.materialId,
        });
    }

    /**
     * The first selected edge determines the main shape; subsequent edges can
     * only be picked on the same shape (same TShape as the first edge's parent).
     * A standalone edge body can only be paired with another standalone edge.
     * 2D operations (face, wire, standalone edges) apply to exactly two edges.
     */
    protected readonly _edgeFilter: IShapeFilter = {
        allow: (shape) => this.canPickEdge(shape as ISubEdgeShape),
    };

    private canPickEdge(shape: ISubEdgeShape): boolean {
        const parent = shape.parent;
        if (parent === undefined || !SUPPORTED_PARENT_TYPES.includes(parent.shapeType)) return false;

        const selected = this.document.selection.getSelectedShapes();
        const firstParent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (firstParent === undefined) return true;
        if (!this.isSameMainShape(parent, firstParent)) return false;

        const is3d = !isPlanarParent(firstParent);
        if (!is3d && selected.length >= 2) {
            // allow re-picking an already selected edge so it can be toggled off
            return selected.some((x) => x.shape.isEqual(shape));
        }
        return true;
    }

    /** A standalone edge only pairs with standalone edges; body edges must share the first edge's body. */
    private isSameMainShape(parent: IShape, firstParent: IShape): boolean {
        if (firstParent.shapeType === ShapeTypes.edge) {
            return parent.shapeType === ShapeTypes.edge;
        }
        return parent.shapeType !== ShapeTypes.edge && parent.isPartner(firstParent);
    }

    /** Pick the edges, then drag to set cornerValue - the same two-step shape as ExtrudeCommand.length. */
    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.edges", {
                multiple: true,
                shapeFilter: this._edgeFilter,
                canFinish: this._canFinish,
                afterSelection: this.queueValueOnExplicitConfirm,
            }),
            new LengthAtAxisStep(this.cornerValuePromptKey, this.getCornerValueStepData, true),
        ];
    }

    /**
     * Ctrl (either keydown or +click) finishes the edge pick without marking
     * it "confirm" - specifically so it can drop into the radius/length-drag
     * step for real interactive dragging. Enter and the checkmark button both
     * mark it "confirm" instead: an explicit "I'm done, apply it" gesture, so
     * that one press finishes the whole command with the current/default
     * cornerValue, the same as if it had been typed - no separate drag-step
     * confirmation needed. This runs once the (already-resolved) edge-select
     * step's own controller is still this.controller - the next step hasn't
     * reassigned it yet.
     */
    private readonly queueValueOnExplicitConfirm = (): void => {
        if (this.controller?.result?.message === "confirm") {
            this.pendingTypedValue = String(this.cornerValue);
        }
    };

    /** A 2D operation needs exactly two edges - finish the pick once both are selected. */
    protected readonly _canFinish = (selected: VisualShapeData[]) => {
        const parent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (parent === undefined) return false;
        return isPlanarParent(parent) && selected.length === 2;
    };

    private readonly getCornerValueStepData = (): LengthAtAxisSnapData => {
        const { point, direction, preview } = this.buildDragContext();

        if (this.pendingTypedValue !== undefined) {
            const text = this.pendingTypedValue;
            this.pendingTypedValue = undefined;
            // The drag step's SnapEventHandler doesn't exist yet at this point
            // (SnapStep.execute constructs it, then calls picker.pickAsync,
            // right after this function returns) - pickAsync itself assigns
            // document.visual.eventHandler and registers the controller's
            // completion listener synchronously, before its own first real
            // await, so a microtask queued here always runs after both are
            // ready, letting applyTypedInput finish the step with no visible
            // drag interaction at all.
            queueMicrotask(() => {
                const view = this.document.application.activeView;
                const handler = this.document.visual.eventHandler;
                if (view && handler instanceof SnapEventHandler) {
                    handler.applyTypedInput(view, text);
                }
            });
        }

        return {
            point,
            direction,
            preview: (p) => {
                if (!p) return [];
                const dist = Math.abs(p.sub(point).dot(direction));
                // Reflect the live drag distance in the properties panel - via
                // the cornerValue setter directly, not the radius/length
                // setter each subclass exposes, which would otherwise
                // re-finish the step on every mouse move.
                this.cornerValue = dist;
                if (dist < Precision.Distance) return [];
                return preview();
            },
            // Enter here (no click/drag, and never having focused the
            // properties-panel field either) would otherwise cancel the whole
            // command (SnapEventHandler's default) - accept the current
            // cornerValue instead, same as clicking to confirm a drag at it.
            acceptOnEnter: () => this.cornerValue,
            // Plain mouse movement over the 3D view (looking around, say)
            // must not silently change the radius/length - only an explicit
            // Ctrl+move does.
            requireCtrlToDrag: true,
        };
    };

    /**
     * Where to anchor the drag handle, and how to preview the corner edit at
     * the current cornerValue - both computed once per finished edge
     * selection (not once per mouse move, unlike the preview mesh itself).
     */
    private buildDragContext(): {
        point: XYZ;
        direction: XYZ;
        preview: () => ShapeMeshData[];
    } {
        const shapes = this.stepDatas[0].shapes;
        const parent = (shapes[0].shape as ISubEdgeShape).parent;

        if (!isPlanarParent(parent)) {
            return this.buildSolidDragContext(shapes, parent);
        }
        return this.buildCornerDragContext(shapes, parent);
    }

    /**
     * One or more edges of a solid/compound: the handle sits at the first
     * edge's midpoint, along its adjacent face's surface (that face's normal
     * crossed with the edge's tangent) - dragging either way along that line
     * grows the value, like pulling a handle across the face away from the
     * edge. cornerValue has no direction, so only the drag's magnitude is
     * used; which of the two ways along this line the user actually drags
     * doesn't matter.
     */
    private buildSolidDragContext(shapes: VisualShapeData[], parent: IShape) {
        const sub = shapes[0].shape as ISubEdgeShape;
        const edge = sub.transformedMul(shapes[0].transform) as IEdge;
        this.disposeStack.add(edge);

        const mid = (edge.firstParameter() + edge.lastParameter()) / 2;
        const point = edge.curve.value(mid);
        const tangent = edge.curve.d1(mid).vec.normalize() ?? XYZ.unitX;

        // findAncestor needs the original (untransformed) sub-edge/parent pair -
        // it walks the parent's own topology tree to find the face(s) owning it.
        const faces = sub.findAncestor(ShapeTypes.face, parent) as IFace[];
        let normal = XYZ.unitZ;
        if (faces.length > 0) {
            const worldFace = faces[0].transformedMul(shapes[0].transform) as IFace;
            this.disposeStack.add(worldFace);
            normal = GeometryUtils.normal(worldFace);
        }
        const direction = normal.cross(tangent).normalize() ?? this.perpendicularTo(tangent);

        const node = shapes[0].owner.node as ShapeNode;
        const edgeIndexes = shapes.map((x) => (x.shape as ISubEdgeShape).index);
        let baseShape: IShape | undefined;
        if (node.shape.isOk) {
            baseShape = node.shape.value.transformedMul(node.transform);
            this.disposeStack.add(baseShape);
        }

        return {
            point,
            direction,
            preview: (): ShapeMeshData[] => {
                if (!baseShape) return [];
                const result =
                    this.operateType === "fillet"
                        ? shapeFactory.fillet(baseShape, edgeIndexes, this.cornerValue)
                        : shapeFactory.chamfer(baseShape, edgeIndexes, this.cornerValue);
                if (!result.isOk) return [];
                return [this.meshShape(result.value)];
            },
        };
    }

    /**
     * Exactly two edges meeting at a corner - a face, a wire, or a
     * standalone edge pair (isPlanarParent treats all three the same). The
     * handle sits at the two edges' shared (or nearest) endpoint, along the
     * bisector of their tangents there - dragging either way along that line
     * grows the value, the same gesture as a 2D sketch fillet.
     */
    private buildCornerDragContext(shapes: VisualShapeData[], parent: IShape) {
        const [worldA, worldB] = shapes.map((s) => s.shape.transformedMul(s.transform) as IEdge);
        this.disposeStack.add(worldA);
        this.disposeStack.add(worldB);
        const { point, direction } = this.cornerAxis(worldA, worldB);

        if (parent.shapeType === ShapeTypes.edge) {
            // A standalone edge pair edits the transformed edges themselves
            // (see modifyStandaloneEdges), so reuse these same copies.
            return {
                point,
                direction,
                preview: (): ShapeMeshData[] => {
                    const triple = this.applyToEdgePair(worldA, worldB);
                    if (!triple.isOk) return [];
                    return triple.value.map((e) => this.meshShape(e));
                },
            };
        }

        // A face/wire corner edits the untransformed picked edges (see
        // computePlanarShape) - the world-space copies above are only used
        // for the drag axis itself.
        const edgeA = shapes[0].shape as IEdge;
        const edgeB = shapes[1].shape as IEdge;
        const face = faceContaining(parent, shapes[0].shape as ISubEdgeShape);

        return {
            point,
            direction,
            preview: (): ShapeMeshData[] => {
                if (face) {
                    const result = this.applyToFace(face, edgeA, edgeB);
                    if (!result.isOk) return [];
                    return [this.meshShape(result.value)];
                }
                const triple = this.applyToEdgePair(edgeA, edgeB);
                if (!triple.isOk) return [];
                return triple.value.map((e) => this.meshShape(e));
            },
        };
    }

    /** The shared/nearest endpoint of two edges, and the bisector of their tangents away from it. */
    private cornerAxis(edgeA: IEdge, edgeB: IEdge): { point: XYZ; direction: XYZ } {
        const [a0, a1] = edgeA.ends();
        const [b0, b1] = edgeB.ends();
        const candidates: [XYZ, XYZ, XYZ, XYZ][] = [
            [a0, a1, b0, b1],
            [a0, a1, b1, b0],
            [a1, a0, b0, b1],
            [a1, a0, b1, b0],
        ];
        let [vertexA, farA, vertexB, farB] = candidates[0];
        let bestDist = vertexA.distanceTo(vertexB);
        for (const candidate of candidates.slice(1)) {
            const dist = candidate[0].distanceTo(candidate[2]);
            if (dist < bestDist) {
                bestDist = dist;
                [vertexA, farA, vertexB, farB] = candidate;
            }
        }

        const point = vertexA.add(vertexB).multiply(0.5);
        const awayA = farA.sub(vertexA).normalize() ?? XYZ.unitX;
        const awayB = farB.sub(vertexB).normalize() ?? XYZ.unitX;
        const bisector = awayA.add(awayB).normalize();
        return { point, direction: bisector ?? this.perpendicularTo(awayA) };
    }

    /** Any unit vector perpendicular to v - used only for the degenerate case where the natural one collapses to zero. */
    private perpendicularTo(v: XYZ): XYZ {
        const helper = Math.abs(v.dot(XYZ.unitZ)) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        return v.cross(helper).normalize() ?? XYZ.unitX;
    }
}
