// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type ISubShape,
    type IWire,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";

/**
 * One picked profile/path reference: a node id, plus - when the pick was a
 * sub-shape of that node's own shape (e.g. an edge of an existing solid) -
 * which one. `shapeType`/`index` use `ShapeTypes.shape` (0) / `-1` rather
 * than `undefined` for "the whole node's shape" so this stays a flat tuple
 * of primitives, safe to hold in a parallel array `@serialize()` field (the
 * Serializer can't serialize a plain object nested inside an array).
 */
export interface SweepRef {
    nodeId: string;
    shapeType: ShapeType;
    index: number;
}

/**
 * Build a SweepRef from a pick: whole-shape when the picked shape's type
 * matches the owner node's own shape's type (same test selectedWholeShapeNodes
 * uses), a sub-shape reference otherwise.
 *
 * Doesn't trust an `.index` on the picked shape to tell them apart - a
 * SelectShapeStep that only allows a narrower shape type than the node's own
 * (e.g. edge/wire/vertex, picking a profile off a solid or a face) can
 * return a sub-shape with no `.index` set when it's the only one of its kind
 * (a single-wire face's one outer wire, say) - so a defined index and "this
 * is a sub-shape" aren't the same thing. Falls back to locating the picked
 * shape's position in the owner's own findSubShapes() list instead, the
 * same indexing scheme resolveSweepRefShape reads back.
 */
export function sweepRefFromPick(ownerNode: ShapeNode, pickedShape: IShape): SweepRef {
    if (!ownerNode.shape.isOk || pickedShape.shapeType === ownerNode.shape.value.shapeType) {
        return { nodeId: ownerNode.id, shapeType: ShapeTypes.shape, index: -1 };
    }
    const candidates = ownerNode.shape.value.findSubShapes(pickedShape.shapeType);
    const index = candidates.findIndex((s) => s.isEqual(pickedShape));
    return { nodeId: ownerNode.id, shapeType: pickedShape.shapeType, index };
}

/**
 * The same whole-shape-vs-sub-shape decision as sweepRefFromPick, in the
 * `undefined`-sentinel shape used by Extrude/Revolve/Offset/ThickSolid's
 * optional sectionShapeType/sectionIndex fields instead of SweepRef's
 * ShapeTypes.shape/-1 sentinels - those predate SweepRef and were never
 * migrated to hold a SweepRef directly, but re-deriving a whole-shape-vs-
 * sub-shape pick by hand (trusting a defined `.index` on the picked shape)
 * has the same false-negative sweepRefFromPick's own doc comment describes.
 */
export function sectionRefFromPick(
    ownerNode: ShapeNode,
    pickedShape: IShape,
): { shapeType: ShapeType | undefined; index: number | undefined } {
    const ref = sweepRefFromPick(ownerNode, pickedShape);
    return ref.index < 0
        ? { shapeType: undefined, index: undefined }
        : { shapeType: ref.shapeType, index: ref.index };
}

/**
 * The referenced node's own shape, or - when the ref names a sub-shape -
 * the sub-shape at that index within it. Sub-shape indexes are positions
 * into the base shape's own findSubShapes() list for shapeType, the same
 * indexing scheme edge/face picking already relies on elsewhere
 * (EdgeCornerNode's edgeIndexes, ExtrudeNode's sectionIndex) - not a stable
 * topological identity, so a change that reorders or removes sub-shapes can
 * point this at the wrong one or fail outright.
 */
export function resolveSweepRefShape(base: IShape, ref: SweepRef, context: string): Result<IShape> {
    if (ref.index < 0) return Result.ok(base);
    const sub = base.findSubShapes(ref.shapeType)[ref.index] as ISubShape | undefined;
    if (!sub) {
        return Result.err(`${context}: section index ${ref.index} no longer exists`);
    }
    return Result.ok(sub);
}

export interface SweepOptions {
    document: IDocument;
    profileNodeIds: string[];
    profileShapeTypes: ShapeType[];
    profileIndexes: number[];
    pathNodeId: string;
    pathShapeType: ShapeType;
    pathIndex: number;
    round: boolean;
}

/**
 * Holds references to the profile and path node ids (and, for a sub-shape
 * pick, the sub-shape's type + index within each) rather than baked
 * profile/path shapes. Editing a referenced node's own parameters
 * recomputes this node. The referenced nodes are hidden, not deleted, by
 * the Sweep command, so the references keep resolving.
 */
@serializable()
export class SweepedNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.sweep";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.sweepEdit";
    }

    @serialize()
    get profileNodeIds(): string[] {
        return this.getPrivateValue("profileNodeIds");
    }

    @serialize()
    get profileShapeTypes(): ShapeType[] {
        return this.getPrivateValue("profileShapeTypes");
    }

    @serialize()
    get profileIndexes(): number[] {
        return this.getPrivateValue("profileIndexes");
    }

    @serialize()
    get pathNodeId(): string {
        return this.getPrivateValue("pathNodeId");
    }

    @serialize()
    get pathShapeType(): ShapeType {
        return this.getPrivateValue("pathShapeType");
    }

    @serialize()
    get pathIndex(): number {
        return this.getPrivateValue("pathIndex");
    }

    @serialize()
    get round(): boolean {
        return this.getPrivateValue("round");
    }
    set round(value: boolean) {
        this.setPropertyEmitShapeChanged("round", value);
    }

    constructor(options: SweepOptions) {
        super(options);
        this.setPrivateValue("profileNodeIds", options.profileNodeIds);
        this.setPrivateValue("profileShapeTypes", options.profileShapeTypes);
        this.setPrivateValue("profileIndexes", options.profileIndexes);
        this.setPrivateValue("pathNodeId", options.pathNodeId);
        this.setPrivateValue("pathShapeType", options.pathShapeType);
        this.setPrivateValue("pathIndex", options.pathIndex);
        this.setPrivateValue("round", options.round);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        let changed = false;
        if (this.pathNodeId === oldId) {
            this.setProperty("pathNodeId", newId);
            changed = true;
        }
        const profileIndex = this.profileNodeIds.indexOf(oldId);
        if (profileIndex !== -1) {
            const profileNodeIds = [...this.profileNodeIds];
            profileNodeIds[profileIndex] = newId;
            this.setProperty("profileNodeIds", profileNodeIds);
            changed = true;
        }
        if (changed) this.setShape(this.generateShape());
        return changed;
    }

    /**
     * Re-point this feature at a new path and/or profile selection, and/or a
     * new round setting, and recompute once. Used by the "re-pick" edit flow
     * to redirect an existing feature without deleting and recreating it
     * (which would break anything downstream that references it).
     */
    updateSelection(profileRefs: SweepRef[], pathRef: SweepRef, round: boolean) {
        this.setProperty(
            "profileNodeIds",
            profileRefs.map((r) => r.nodeId),
        );
        this.setProperty(
            "profileShapeTypes",
            profileRefs.map((r) => r.shapeType),
        );
        this.setProperty(
            "profileIndexes",
            profileRefs.map((r) => r.index),
        );
        this.setProperty("pathNodeId", pathRef.nodeId);
        this.setProperty("pathShapeType", pathRef.shapeType);
        this.setProperty("pathIndex", pathRef.index);
        this.setProperty("round", round);
        this.setShape(this.generateShape());
    }

    /**
     * The path, not a profile - deleting a sweep is closer to "undo
     * modifying the path" than to "undo consuming a profile", matching
     * BooleanNode's base/tool split. The profile(s) simply become
     * unconsumed and visible again, same as any other now-unused input.
     */
    override get primaryInputId(): string | undefined {
        return this.pathNodeId;
    }

    private ensureWire(shape: IShape): Result<IWire> {
        if (shape.shapeType === ShapeTypes.wire) return Result.ok(shape as IWire);
        return shapeFactory.wire([shape as IEdge]);
    }

    override generateShape(): Result<IShape> {
        const pathBase = this.resolveInput(this.pathNodeId);
        if (!pathBase) return Result.err(`Sweep: path shape "${this.pathNodeId}" no longer exists`);
        if (!pathBase.shape.isOk) return Result.err(pathBase.shape.error);

        const profileBases: ShapeNode[] = [];
        for (const id of this.profileNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Sweep: profile shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            profileBases.push(base);
        }

        this.subscribeTo([pathBase, ...profileBases]);

        const pathRef: SweepRef = {
            nodeId: this.pathNodeId,
            shapeType: this.pathShapeType,
            index: this.pathIndex,
        };
        const pathSectionResult = resolveSweepRefShape(
            pathBase.shape.value.transformedMul(pathBase.transform),
            pathRef,
            "Sweep",
        );
        if (!pathSectionResult.isOk) return pathSectionResult;
        const pathResult = this.ensureWire(pathSectionResult.value);
        if (!pathResult.isOk) return Result.err(pathResult.error);
        const path = pathResult.value;

        const profiles: IShape[] = [];
        for (let i = 0; i < profileBases.length; i++) {
            const base = profileBases[i];
            const ref: SweepRef = {
                nodeId: this.profileNodeIds[i],
                shapeType: this.profileShapeTypes[i],
                index: this.profileIndexes[i],
            };
            const sectionResult = resolveSweepRefShape(
                base.shape.value.transformedMul(base.transform),
                ref,
                "Sweep",
            );
            if (!sectionResult.isOk) return sectionResult;
            const wireResult = this.ensureWire(sectionResult.value);
            if (!wireResult.isOk) return Result.err(wireResult.error);
            profiles.push(wireResult.value);
        }

        return shapeFactory.sweep(profiles, path, this.round);
    }
}
