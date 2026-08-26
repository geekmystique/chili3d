// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IFace,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    serializable,
    serialize,
} from "@chili3d/core";

export interface ShellOptions {
    document: IDocument;
    sourceNodeIds: string[];
}

/**
 * Holds references to the face node ids that bound this shell, rather than
 * baked face shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToShell,
 * so the references keep resolving.
 */
@serializable()
export class ShellNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.shell";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.shellEdit";
    }

    @serialize()
    get sourceNodeIds(): string[] {
        return this.getPrivateValue("sourceNodeIds");
    }

    constructor(options: ShellOptions) {
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
     * bounding a shell, but the first one is the natural place to collapse
     * back to if this feature is deleted (mirroring LoftNode).
     */
    override get primaryInputId(): string | undefined {
        return this.sourceNodeIds[0];
    }

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sourceNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Shell: source shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const faces = bases.map((base) => base.shape.value.transformedMul(base.transform)) as IFace[];
        return shapeFactory.shell(faces);
    }
}
