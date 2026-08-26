// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";

export interface WireOptions {
    document: IDocument;
    sourceNodeIds: string[];
}

/**
 * Holds references to the edge/wire node ids being combined, rather than
 * baked edge shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToWire,
 * so the references keep resolving.
 */
@serializable()
export class WireNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.wire";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.wireEdit";
    }

    @serialize()
    get sourceNodeIds(): string[] {
        return this.getPrivateValue("sourceNodeIds");
    }

    constructor(options: WireOptions) {
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
     * combining edges/wires, but the first one is the natural place to
     * collapse back to if this feature is deleted (mirroring LoftNode).
     */
    override get primaryInputId(): string | undefined {
        return this.sourceNodeIds[0];
    }

    override generateShape(): Result<IShape> {
        const bases: ShapeNode[] = [];
        for (const id of this.sourceNodeIds) {
            const base = this.resolveInput(id);
            if (!base) return Result.err(`Wire: source shape "${id}" no longer exists`);
            if (!base.shape.isOk) return Result.err(base.shape.error);
            bases.push(base);
        }

        this.subscribeTo(bases);

        const edges: IEdge[] = [];
        for (const base of bases) {
            const shape = base.shape.value.transformedMul(base.transform);
            if (shape.shapeType === ShapeTypes.edge) {
                edges.push(shape as IEdge);
            } else if (shape.shapeType === ShapeTypes.wire) {
                edges.push(...(shape.findSubShapes(ShapeTypes.edge) as IEdge[]));
            }
        }

        return shapeFactory.wire(edges);
    }
}
