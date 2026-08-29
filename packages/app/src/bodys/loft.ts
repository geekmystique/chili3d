// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type Continuity,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type ISubShape,
    type IVertex,
    type IWire,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    type ShapeType,
    serializable,
    serialize,
} from "@chili3d/core";
import { resolveSweepRefShape, type SweepRef } from "./sweep";

export interface LoftOptions {
    document: IDocument;
    sectionNodeIds: string[];
    sectionShapeTypes: ShapeType[];
    sectionIndexes: number[];
    isSolid: boolean;
    isRuled: boolean;
    continuity: Continuity;
}

/**
 * Holds references to its section node ids (and, for a sub-shape pick, the
 * sub-shape's type + index within each) rather than baked section shapes.
 * Editing a referenced node's own parameters recomputes this node. The
 * referenced nodes are hidden, not deleted, by LoftCommand, so the
 * references keep resolving.
 *
 * Held as parallel arrays (like SweepedNode's profile) rather than an array
 * of {nodeId, shapeType, index} objects - the Serializer can't serialize a
 * plain object nested inside an array, only flat primitives, arrays of
 * primitives, or registered class instances.
 */
@serializable()
export class LoftNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.loft";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.loftEdit";
    }

    @serialize()
    get sectionNodeIds(): string[] {
        return this.getPrivateValue("sectionNodeIds");
    }

    @serialize()
    get sectionShapeTypes(): ShapeType[] {
        return this.getPrivateValue("sectionShapeTypes");
    }

    @serialize()
    get sectionIndexes(): number[] {
        return this.getPrivateValue("sectionIndexes");
    }

    @serialize()
    get isSolid(): boolean {
        return this.getPrivateValue("isSolid");
    }
    set isSolid(value: boolean) {
        this.setPropertyEmitShapeChanged("isSolid", value);
    }

    @serialize()
    get isRuled(): boolean {
        return this.getPrivateValue("isRuled");
    }
    set isRuled(value: boolean) {
        this.setPropertyEmitShapeChanged("isRuled", value);
    }

    @serialize()
    get continuity(): Continuity {
        return this.getPrivateValue("continuity");
    }
    set continuity(value: Continuity) {
        this.setPropertyEmitShapeChanged("continuity", value);
    }

    constructor(options: LoftOptions) {
        super(options);
        this.setPrivateValue("sectionNodeIds", options.sectionNodeIds);
        this.setPrivateValue("sectionShapeTypes", options.sectionShapeTypes);
        this.setPrivateValue("sectionIndexes", options.sectionIndexes);
        this.setPrivateValue("isSolid", options.isSolid);
        this.setPrivateValue("isRuled", options.isRuled);
        this.setPrivateValue("continuity", options.continuity);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        const index = this.sectionNodeIds.indexOf(oldId);
        if (index === -1) return false;
        const sectionNodeIds = [...this.sectionNodeIds];
        sectionNodeIds[index] = newId;
        this.setProperty("sectionNodeIds", sectionNodeIds);
        this.setShape(this.generateShape());
        return true;
    }

    /**
     * Re-point this feature at a new set of sections, and/or new solid/ruled/
     * continuity settings, and recompute once. Used by the "re-pick" edit
     * flow to redirect an existing feature without deleting and recreating
     * it (which would break anything downstream that references it).
     */
    updateSections(
        sectionNodeIds: string[],
        sectionShapeTypes: ShapeType[],
        sectionIndexes: number[],
        isSolid: boolean,
        isRuled: boolean,
        continuity: Continuity,
    ) {
        this.setProperty("sectionNodeIds", sectionNodeIds);
        this.setProperty("sectionShapeTypes", sectionShapeTypes);
        this.setProperty("sectionIndexes", sectionIndexes);
        this.setProperty("isSolid", isSolid);
        this.setProperty("isRuled", isRuled);
        this.setProperty("continuity", continuity);
        this.setShape(this.generateShape());
    }

    /**
     * The first section - no single input is more "primary" than another in
     * a loft, but the first one is the natural place to collapse back to if
     * this feature is deleted (mirroring how the command orders sections).
     */
    override get primaryInputId(): string | undefined {
        return this.sectionNodeIds[0];
    }

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sectionNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Loft: section shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const sections: IShape[] = [];
        for (let i = 0; i < bases.length; i++) {
            const base = bases[i];
            const ref: SweepRef = {
                nodeId: this.sectionNodeIds[i],
                shapeType: this.sectionShapeTypes[i],
                index: this.sectionIndexes[i],
            };
            const result = resolveSweepRefShape(base.shape.value.transformedMul(base.transform), ref, "Loft");
            if (!result.isOk) return result;
            sections.push(result.value);
        }

        return shapeFactory.loft(
            sections as (IVertex | IEdge | IWire)[],
            this.isSolid,
            this.isRuled,
            this.continuity,
        );
    }
}
