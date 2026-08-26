// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    serialize,
} from "@chili3d/core";

export interface SourceListShapeOptions {
    document: IDocument;
    sourceNodeIds: string[];
}

/**
 * Shared base for nodes that combine an ordered list of source node ids into
 * one shape (the Wire/Face/Shell/Solid/Compound conversions): resolving each
 * source, subscribing to it, and reading its transformed shape is identical
 * across all of them - only how the resolved shapes combine into the final
 * result differs, via combineShapes().
 */
export abstract class SourceListShapeNode extends ReferenceShapeNode {
    /** Short label for error messages ("Wire", "Face", ...) - the class name without "Node". */
    protected abstract readonly errorLabel: string;

    @serialize()
    get sourceNodeIds(): string[] {
        return this.getPrivateValue("sourceNodeIds");
    }

    constructor(options: SourceListShapeOptions) {
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
     * The first source - no single input is more "primary" than another
     * among an ordered combine list, but the first one is the natural place
     * to collapse back to if this feature is deleted (mirroring LoftNode).
     */
    override get primaryInputId(): string | undefined {
        return this.sourceNodeIds[0];
    }

    /** Combine the resolved, already-transformed source shapes into this node's own shape. */
    protected abstract combineShapes(shapes: IShape[]): Result<IShape>;

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sourceNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`${this.errorLabel}: source shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const shapes = bases.map((base) => base.shape.value.transformedMul(base.transform));
        return this.combineShapes(shapes);
    }
}
