// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    I18n,
    type I18nKeys,
    type IDocument,
    type IShape,
    NodeUtils,
    ReferenceShapeNode,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";

export type EdgeCornerOperateType = "fillet" | "chamfer";

export interface EdgeCornerOptions {
    document: IDocument;
    operateType: EdgeCornerOperateType;
    baseNodeId: string;
    edgeIndexes: number[];
    value: number;
}

/**
 * Holds a reference to the base node id and the edge indexes to fillet or
 * chamfer, rather than a baked shape. Editing the base body's parameters
 * recomputes this node. The edge indexes are positions into the base
 * shape's own edge list, not a stable topological identity, so a change
 * that reorders or removes edges can make them point at the wrong edge or
 * fail outright - the same limitation BooleanNode's node references have,
 * until stable sub-shape identity exists.
 */
@serializable()
export class EdgeCornerNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return this.operateType === "fillet" ? "body.fillet" : "body.chamfer";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.edgeCornerEdit";
    }

    @serialize()
    get operateType(): EdgeCornerOperateType {
        return this.getPrivateValue("operateType");
    }

    @serialize()
    get baseNodeId(): string {
        return this.getPrivateValue("baseNodeId");
    }

    @serialize()
    get edgeIndexes(): number[] {
        return this.getPrivateValue("edgeIndexes");
    }

    @serialize()
    get value(): number {
        return this.getPrivateValue("value");
    }

    constructor(options: EdgeCornerOptions) {
        super(options);
        this.setPrivateValue("operateType", options.operateType);
        this.setPrivateValue("baseNodeId", options.baseNodeId);
        this.setPrivateValue("edgeIndexes", options.edgeIndexes);
        this.setPrivateValue("value", options.value);
        // ParameterShapeNode's constructor names the node from display() before
        // operateType is set above, so it always picks the same branch (and,
        // having scanned the tree before edgeIndexes/operateType existed on
        // this node, numbered against the wrong display name too). Redo it now
        // that display() can tell fillet and chamfer apart.
        this.setPrivateValue(
            "name",
            NodeUtils.nextNumberedName(options.document, I18n.translate(this.display())),
        );
    }

    /**
     * Re-point this feature at a new edge selection and/or value, keeping the
     * same base node, and recompute once. Used by the "re-pick" edit flow to
     * redirect an existing feature without deleting and recreating it (which
     * would break anything downstream that references it).
     */
    updateSelection(edgeIndexes: number[], value: number) {
        this.setProperty("edgeIndexes", edgeIndexes);
        this.setProperty("value", value);
        this.setShape(this.generateShape());
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.baseNodeId !== oldId) return false;
        this.setProperty("baseNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    override get primaryInputId(): string | undefined {
        return this.baseNodeId;
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.baseNodeId);
        if (!base) {
            return Result.err(`${this.operateType}: base shape "${this.baseNodeId}" no longer exists`);
        }
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        return this.operateType === "fillet"
            ? shapeFactory.fillet(base.shape.value, this.edgeIndexes, this.value)
            : shapeFactory.chamfer(base.shape.value, this.edgeIndexes, this.value);
    }
}
