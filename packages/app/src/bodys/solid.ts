// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IShape,
    type IShell,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    serializable,
    serialize,
} from "@chili3d/core";
import { repairShape } from "./shapeUtils";

export interface SolidOptions {
    document: IDocument;
    sourceNodeIds: string[];
}

/**
 * Holds references to the shell node ids that bound this solid, rather than
 * baked shell shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToSolid,
 * so the references keep resolving.
 */
@serializable()
export class SolidNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.solid";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.solidEdit";
    }

    @serialize()
    get sourceNodeIds(): string[] {
        return this.getPrivateValue("sourceNodeIds");
    }

    constructor(options: SolidOptions) {
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
     * The first source - no single input is more "primary" than another when
     * bounding a solid, but the first one is the natural place to collapse
     * back to if this feature is deleted (mirroring LoftNode).
     */
    override get primaryInputId(): string | undefined {
        return this.sourceNodeIds[0];
    }

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sourceNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Solid: source shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const shells = bases.map((base) => base.shape.value.transformedMul(base.transform)) as IShell[];
        const shapeResult = shapeFactory.solid(shells);
        if (!shapeResult.isOk) return shapeResult;

        return Result.ok(repairShape(shapeResult.value, 1e-7));
    }
}
