// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    serializable,
    serialize,
} from "@chili3d/core";

export interface CompoundOptions {
    document: IDocument;
    sourceNodeIds: string[];
}

/**
 * Holds references to the node ids combined into this compound, rather than
 * baked shapes. Editing a referenced node's own parameters recomputes this
 * node. The referenced nodes are hidden, not deleted, by ConvertToCompound,
 * so the references keep resolving.
 */
@serializable()
export class CompoundNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.compound";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.compoundEdit";
    }

    @serialize()
    get sourceNodeIds(): string[] {
        return this.getPrivateValue("sourceNodeIds");
    }

    constructor(options: CompoundOptions) {
        super(options);
        this.setPrivateValue("sourceNodeIds", options.sourceNodeIds);
    }

    /**
     * Re-point this feature at a new set of sources and recompute once. Used
     * by the "re-pick" edit flow to redirect an existing feature without
     * deleting and recreating it (which would break anything downstream that
     * references it).
     */
    updateSources(sourceNodeIds: string[]) {
        this.setProperty("sourceNodeIds", sourceNodeIds);
        this.setShape(this.generateShape());
    }

    override redirectReference(oldId: string, newId: string): boolean {
        const index = this.sourceNodeIds.indexOf(oldId);
        if (index === -1) return false;
        const sourceNodeIds = [...this.sourceNodeIds];
        sourceNodeIds[index] = newId;
        this.setProperty("sourceNodeIds", sourceNodeIds);
        this.setShape(this.generateShape());
        return true;
    }

    /**
     * The first source - no single input is more "primary" than another in a
     * compound, but the first one is the natural place to collapse back to
     * if this feature is deleted (mirroring LoftNode).
     */
    override get primaryInputId(): string | undefined {
        return this.sourceNodeIds[0];
    }

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sourceNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Compound: source shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const shapes = bases.map((base) => base.shape.value.transformedMul(base.transform));
        return shapeFactory.combine(shapes);
    }
}
